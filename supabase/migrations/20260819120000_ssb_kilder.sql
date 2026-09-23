-- Per-kilde henteflagg og hurtigbuffer for SSB-uttrekket.
--
-- ssb_datasett (forrige migrasjon) er fortsatt «siste gyldige sammensatte
-- uttrekk per tema» — uendret, fortsatt det /api/ssb/[tema] leser direkte.
-- Denne tabellen ligger UNDER den: én rad per underliggende kilde (SSB-tabell
-- eller ekstern API), ikke per tema, slik at "Hent nå" kan hente bare det som
-- faktisk mangler i stedet for å hente hele temaet på nytt hver gang.
--
-- payload er NULL helt til kilden er hentet én gang — det er «aldri hentet»,
-- ikke en feiltilstand. tvungen_oppdatering er avmerkingsboksen i adminpanelet
-- («oppdater denne uansett, jeg vet SSB har publisert noe nytt»); den
-- nullstilles automatisk ved vellykket henting, men står igjen ved feil slik
-- at et mislykket tvunget forsøk fortsatt er flagget for et nytt forsøk.

create table if not exists public.ssb_kilder (
  -- Stabil nøkkel, f.eks. 'naering:11616' eller 'valg:valgresultat'.
  id text primary key,
  tema text not null,
  -- Menneskelesbart navn til adminpanelet, f.eks. "Sysselsatte og arbeidsplasser".
  navn text not null,
  kilde text not null,
  -- Denne kildens EGET bidrag: { fakta?, befolkning?, resultater?, advarsler }.
  -- NULL = aldri hentet.
  payload jsonb,
  -- Når payload sist ble hentet med suksess. NULL = aldri.
  hentet timestamptz,

  sist_forsokt timestamptz,
  siste_feil text,
  feil_siden timestamptz,
  antall_feil integer not null default 0,

  tvungen_oppdatering boolean not null default false,

  oppdatert timestamptz not null default now()
);

comment on table public.ssb_kilder is
  'Én rad per underliggende SSB-tabell/ekstern kilde. Grunnlaget ssb_datasett settes sammen fra.';

alter table public.ssb_kilder enable row level security;

drop policy if exists ssb_kilder_service_only on public.ssb_kilder;
create policy ssb_kilder_service_only
  on public.ssb_kilder
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
