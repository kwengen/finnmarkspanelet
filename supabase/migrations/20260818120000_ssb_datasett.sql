-- Siste gyldige SSB-uttrekk per tema.
--
-- Tabellen er et «last known good»-lager, ikke en cache i vanlig forstand:
-- raden overskrives bare når et nytt uttrekk har bestått valideringen. Svarer
-- SSB feil, eller svarer riktig med gale tall, står forrige gode uttrekk igjen
-- og serveres videre med tydelig merking om at det er foreldet.
--
-- Feilene lagres på samme rad framfor i en egen hendelsestabell, fordi det
-- eneste vi trenger å vite er «hva gikk galt sist, og hvor lenge har det
-- pågått». Hele historikken ville ikke blitt lest.

create table if not exists public.ssb_datasett (
  tema text primary key,
  -- Radformatet i payload. Klienter som forventer en annen versjon skal be om
  -- nytt uttrekk framfor å tolke rader de ikke kjenner.
  kontrakt integer not null,
  kilde text not null,
  -- Når tallene i payload ble hentet fra SSB (ikke når raden ble skrevet).
  hentet timestamptz not null,
  payload jsonb not null,
  advarsler jsonb not null default '[]'::jsonb,

  -- Siste hentforsøk, uansett utfall. Sammen med hentet viser dette hvor lenge
  -- oppdateringen har vært nede.
  sist_forsokt timestamptz,
  siste_feil text,
  feil_siden timestamptz,
  antall_feil integer not null default 0,

  oppdatert timestamptz not null default now()
);

comment on table public.ssb_datasett is
  'Siste validerte uttrekk fra SSBs åpne API, per tema. Overskrives kun ved bestått validering.';

alter table public.ssb_datasett enable row level security;

-- Bare service role skriver og leser. Datasettet er offentlig statistikk, men
-- det eksponeres gjennom /api/ssb slik at vi beholder ett sted å cache,
-- validere og måle — ikke ved å åpne tabellen for anon.
drop policy if exists ssb_datasett_service_only on public.ssb_datasett;
create policy ssb_datasett_service_only
  on public.ssb_datasett
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
