# Finnmarkspanelet

Offentlig statistikkside om Finnmark, bygget på SSBs åpne API. Ingen kundedata,
ingen regnskapsintegrasjon, ingen brukerinnlogging.

Panelet lå tidligere inne i TinkrFlows. Det er flyttet hit fordi det var eneste
grunn til at TinkrFlows — som har skrivetilgang til regnskapet — måtte ha
offentlige unntak i tilgangskontrollen sin. Bakgrunnen står i
`docs/FINNMARK-UTSKILLING-2026-09-14.md` i TinkrFlows-repoet.

## Slik henger det sammen

```
public/finnmark/index.html   ett selvstendig HTML-dokument, servert på /
        │  henter ved hvert besøk
        ▼
GET /api/ssb/<tema>          leser BARE lageret, henter aldri fra SSB selv
        │
        ▼
ssb_datasett / ssb_kilder    siste uttrekk som besto validering
        ▲
        │  skriver
GET /api/ssb/refresh         kjøres for hånd, aldri av en tidsplan
/admin                       samme henting, med status per kilde
```

Ingen sidevisning kan utløse et SSB-kall. Feiler en henting, eller feiler
valideringen, beholdes forrige gyldige uttrekk og serveres videre merket
`foreldet`.

## Miljøvariabler

Alle tre settes i Vercel, kun i **Production**. Det er tre, ikke fire: en egen
hemmelighet for henting ville gjort samme jobb som adminnøkkelen.

| Variabel | Hva den er |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` for dette prosjektets egen database |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role-nøkkelen til **samme** prosjekt |
| `FINNMARK_ADMIN_KEY` | Nøkkelen `/admin` spør etter, og som gater `/api/ssb/refresh` |

Ingen av dem skal ha samme verdi som noe i TinkrFlows. Hele poenget med
utskillingen er at de to installasjonene ikke deler legitimasjon.

Det finnes ingen cron her — statistikken endrer seg typisk årlig, og en
tidsplan ville bare vært et kall uten formål.

## Oppdatere data

```bash
curl -H "Authorization: Bearer $FINNMARK_ADMIN_KEY" \
  https://<domene>/api/ssb/refresh
```

Uten `?tema=` vurderes alle temaer. Bare kilder som mangler, sist feilet, eller
er flagget for tvungen oppdatering i `/admin`, hentes — ikke hele temaet på
nytt hver gang.

## Adminpanelet

`/admin` viser status per underliggende kilde og lar deg utløse en henting
eller flagge en kilde for neste kjøring.

Porten er én delt nøkkel i `FINNMARK_ADMIN_KEY`, sendt som
`Authorization: Bearer`. Nettleseren husker den bare i `sessionStorage`.
Det er med vilje så lite: panelet styrer hvem som kan *hente* data, ikke hvem
som får *se* den. Alt her er offentlig SSB-statistikk, og `/api/ssb/<tema>`
serverer de samme tallene helt uten autorisasjon.

Skulle panelet en dag styre noe som ikke er offentlig, er dette for lite. Da er
riktig svar ekte innlogging, ikke en lengre delt nøkkel.

## Database

To frittstående tabeller, ingen fremmednøkler, ingen kobling til noe annet:

- `ssb_datasett` — siste validerte uttrekk per tema
- `ssb_kilder` — én rad per underliggende SSB-tabell

Begge har RLS med en policy som bare slipper `service_role` til. All tilgang
går gjennom API-rutene; nettleseren snakker aldri direkte med databasen, og
prosjektet bruker derfor ingen anon-nøkkel.

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
