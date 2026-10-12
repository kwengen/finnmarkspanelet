# Finnmarkspanelet

Innlogget portal for Finnmark Arbeiderparti, bygget på SSBs åpne API. Alt
frontend-innhold og alle dataendepunkter krever innlogging.

**https://finnmarkspanelet.vercel.app**

Panelet lå tidligere inne i TinkrFlows. Det er flyttet hit fordi det var eneste
grunn til at TinkrFlows — som har skrivetilgang til regnskapet — måtte ha
offentlige unntak i tilgangskontrollen sin. Bakgrunnen står i
`docs/FINNMARK-UTSKILLING-2026-09-14.md` i TinkrFlows-repoet.

## Slik henger det sammen

```
proxy.ts                    håndhever innlogging på sider, statiske filer og API-er
        │
public/finnmark/index.html  ett selvstendig HTML-dokument, servert på /
        │  henter ved hvert innloggede besøk
        ▼
GET /api/ssb/<tema>          krever innlogging og leser BARE lageret
        │
        ▼
ssb_datasett / ssb_kilder    siste uttrekk som besto validering
        ▲
        │  skriver
GET /api/ssb/refresh         krever superadministrator og kjøres for hånd
/admin                       systemadministrasjon, kun superadministrator
/brukere                     brukeradministrasjon for administratorer og
                            superadministratorer
```

Ingen sidevisning kan utløse et SSB-kall. Feiler en henting, eller feiler
valideringen, beholdes forrige gyldige uttrekk og serveres videre merket
`foreldet`.

## Miljøvariabler

Alle settes i Vercel, kun i **Production**. Publishable-nøkkelen kan sendes til
nettleseren; service role-nøkkelen skal aldri eksponeres.

| Variabel | Hva den er |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` for dette prosjektets egen database |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for Auth-klienten |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role-nøkkelen til **samme** prosjekt |
| `FINNMARK_BOOTSTRAP_SUPERADMIN_EMAIL` | E-posten som får første superadministratorrolle |
| `NEXT_PUBLIC_SITE_URL` | Valgfri offentlig URL for invitasjonslenker |

Ingen av dem skal ha samme verdi som noe i TinkrFlows. Hele poenget med
utskillingen er at de to installasjonene ikke deler legitimasjon.

Det finnes ingen cron her — statistikken endrer seg typisk årlig, og en
tidsplan ville bare vært et kall uten formål.

## Oppdatere data

Logg inn som superadministrator og bruk `/admin`. Der kan registrerte SSB-kilder
oppdateres enkeltvis eller samlet. API-et krever den samme innloggede
Supabase-sesjonen og kan ikke lenger åpnes med en delt nøkkel.

Uten `?tema=` vurderes alle temaer. Bare kilder som mangler, sist feilet, eller
er flagget for tvungen oppdatering i `/admin`, hentes — ikke hele temaet på
nytt hver gang.

**Første gang databasen er tom rekker ikke ett kall gjennom.** Ruten har
`maxDuration = 300`, og `px.ts` holder 2,1 sekunders pause mellom hvert
SSB-kall for å holde seg under kallgrensen på 30 spørringer per minutt. En full
førstegangshenting bruker mer enn fem minutter og blir kuttet et sted uti
rekkefølgen befolkning → næring → økonomi.

Det er ikke en feil, og det retter seg selv: kjør kallet på nytt, så fortsetter
det der det stoppet. Vil du unngå avbruddet, ta ett tema om gangen med
`?tema=okonomi` og så videre. I daglig drift er det aldri et problem — da
mangler det bare noen få kilder om gangen.

## Roller og administrasjon

Det finnes tre roller:

- `bruker` — tilgang til hele frontend.
- `administrator` — tilgang til hele frontend og `/brukere`, der vanlige brukere
  kan inviteres, aktiveres, deaktiveres og slettes.
- `superadministrator` — full brukeradministrasjon, rolleendringer og
  systemadministrasjon på `/admin`.

Den første superadministratoren opprettes ved at e-postadressen i
`FINNMARK_BOOTSTRAP_SUPERADMIN_EMAIL` logger inn etter at migrasjonen er kjørt.
Fjern deretter variabelen fra miljøet.

## Database

To frittstående tabeller, ingen fremmednøkler, ingen kobling til noe annet:

- `ssb_datasett` — siste validerte uttrekk per tema
- `ssb_kilder` — én rad per underliggende SSB-tabell
- `user_roles` — serverstyrte roller koblet til Supabase Auth-brukere

Alle tabellene har RLS. `user_roles` og SSB-lageret er kun tilgjengelig for
`service_role`; nettleseren snakker aldri direkte med databasen.

Migrasjonene ligger i `supabase/migrations/`.

## Utvikling

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

`scripts/ssb/` er frittstående Node-skript for engangsuttrekk, uten Supabase.
Se `scripts/ssb/README.md`.
