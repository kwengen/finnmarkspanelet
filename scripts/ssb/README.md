# SSB-uttrekk til Finnmarkspanelet

Skriptene her henter statistikk fra SSBs åpne API og legger den inn i
`finnmark-datapanel.html`. Ingen nøkler, ingen registrering — API-ene er åpne.

Kjør fra repo-rota. Krever bare Node 18+.

```bash
node scripts/ssb/regioner.mjs      # 1. verifiser kommunenumrene
node scripts/ssb/befolkning.mjs    # 2. hent befolkning etter kjønn og alder
node scripts/ssb/bygg.mjs          # 3. legg dataene inn i HTML-fila
```

Åpne `finnmark-datapanel.html` i nettleseren etterpå. Banneret øverst sier
hvilke tall som er ekte og hvilke som fortsatt er syntetiske.

## Rekkefølgen er ikke valgfri

`regioner.mjs` må kjøres først. Kommunenumrene i HTML-fila er skrevet fra
hukommelsen og er ikke verifisert. Henter du data med feil nummer, får du tall
for feil kommune — og ingenting i utdataene vil se galt ut. `befolkning.mjs`
nekter å kjøre hvis `regioner.mjs` fant avvik.

Kodene endret seg to ganger, og mellomperioden er den vanskelige:

| Periode | Fylke | Kommunekoder |
|---|---|---|
| ≤ 2019 | Finnmark (20) | `20xx` |
| 2020–2023 | Troms og Finnmark (54) | `54xx` — **også Troms** |
| 2024– | Finnmark (56) | `56xx` |

I 2020–2023 kan vi ikke plukke Finnmark på prefiks, fordi Troms deler
prefiksen. `regioner.mjs` går derfor bakover fra 2024-settet via KLASS sine
endringslister i stedet for å gjette.

## Hva skriptene gjør

| Skript | Gjør |
|---|---|
| `inspect.mjs` | Skriver ut dimensjoner og koder for en tabell. Brukes når et hentskript klager på at noe ikke stemmer. |
| `regioner.mjs` | Henter kommuneinndelingen fra KLASS, bygger kodekjeden 2019→2020→2024 per kommune, og rapporterer avvik mot `REGIONS` i HTML-fila. |
| `befolkning.mjs` | Henter tabell 07459 (befolkning etter kjønn og ettårig alder) og bygger femårsgrupper, folkemengde, andel 0–19 og andel 67+. |
| `bygg.mjs` | Legger alt i `scripts/ssb/data/*.json` inn i JSON-blokka i HTML-fila. |
| `lib.mjs` | Delte hjelpefunksjoner: kall med pause, JSON-stat2-utflating, oppslag av dimensjonsnavn. |

Utdata havner i `scripts/ssb/data/` og er ikke sjekket inn — kjør skriptene på
nytt i stedet for å ta vare på filene.

## Feilsøking

**`node scripts/ssb/inspect.mjs 07459`** er alltid første steg. Den viser hva
tabellen faktisk inneholder, og de fleste feil er at en dimensjon eller kode
heter noe annet enn antatt.

| Symptom | Sannsynlig årsak |
|---|---|
| HTTP 403 | Uttrekket er for stort, eller en kode finnes ikke. `inspect.mjs` viser cellemengden nederst. |
| HTTP 429 | For mange kall. Skriptene pauser 900 ms mellom kall; vent litt og prøv igjen. |
| «har ikke årene …» | Tabellen dekker en annen periode. Bruk `--fra`/`--til`. |
| «Fant bare N ettårige alderskoder» | Tabellen bruker aldersgrupper, ikke ettårig alder. Da må et annet tabellnummer brukes. |
| Advarsel om at to koder har tall samme år | SSB har publisert samme kommune under både gammel og ny kode. Skriptet bruker årets gjeldende kode og hopper over resten — kontroller at det er riktig. |

## Å hente et nytt tema

`befolkning.mjs` er malen. Et nytt hentskript skal:

1. lese `data/regioner.json`, aldri kommunelisten i HTML-fila,
2. lese tabellens metadata og slå opp dimensjonsnavn med `finnDim` framfor å
   hardkode dem,
3. velge kommunekoden som gjaldt hvert enkelt år, og si fra hvis flere koder
   har tall samtidig,
4. skrive `data/<tema>.json` med feltene `kilde`, `hentet`, `aar`, `fakta` og
   eventuelt `befolkning`/`resultater`, samt `advarsler`.

`fakta` er rader på formen `[region, år, indikator, verdi]`, der `indikator`
må være en nøkkel som finnes i `IND` i HTML-fila. Filnavnet blir temanøkkelen
siden bruker, så `okonomi.json` blir til `SSB.okonomi`.

Aktuelle tabeller for de gjenstående temaene, alle uverifiserte — kjør
`inspect.mjs` før du skriver kode mot dem:

- Kommuneøkonomi: KOSTRA, f.eks. 12134
- Sysselsetting og arbeidsplasser: 07984, 11616
- Foretak: 07091
- Kommunestyrevalg: 12695 · Stortingsvalg: 08092
