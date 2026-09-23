/**
 * Valgresultater: kommunestyrevalg (SSB) og stortingsvalg (valgresultat.no).
 *
 * Stortingsvalg kommer IKKE fra SSB. To forsøk mot Statistikkbanken, begge
 * feil: 08092 (websøk) pekte på en innvandrings-/næringstabell; 11691
 * (funnet av brukeren direkte på SSBs egen side) viste seg å handle om
 * stemmegyldighet og -tidspunkt, ikke partifordeling — dimensjonene er
 * Region, StemmeGyldigNyn, StemmeTidspktNyn, ContentsCode, Tid. SSB har en
 * egen artikkel («Slik finner du statistikk for valgdistrikter») som
 * bekrefter at stortingsvalg-statistikk er strukturert rundt valgdistrikt
 * (≈fylke), ikke kommune — trolig fins det rett og slett ikke en
 * kommunenivå-tabell for dette i Statistikkbanken. Løst i stedet via
 * Valgdirektoratets valgresultat.no, som går helt ned til kommune — se
 * ./valgresultat.ts for den undersøkelsen og implementasjonen.
 *
 * Tabell 01180 (kommunestyrevalg) hadde bare «Godkjente stemmer» (rå
 * stemmetall), ikke en ferdig prosentandel. Løst ved å hente stemmetall for
 * ALLE partier (ikke bare de åtte vi viser), summere til totalt antall
 * godkjente stemmer per kommune og år, og regne prosent selv — «godkjente
 * stemmer» er allerede SSBs egen filtrering bort av blanke/forkastede
 * stemmer, så summen er en riktig nevner.
 *
 * DELVIS LØST, så delvis IKKE: 2019/2023 feilet først fordi tabellen bruker
 * DAGENS kommunestruktur («Kommuner 2024-») for 2023 — bekreftet av
 * brukeren med skjermbilde, 2023-tall vises under 56xx-koder. Men etter den
 * fiksen ga 2011/2015/2019 «fant ingen totalsum» i ALLE 18 kommuner samtidig
 * — diagnostikk viste 1098 rader (uendret radantall år for år) men SUM 0
 * for akkurat disse tre årene, mot en ekte sum for 2023. Radene finnes altså
 * under 56xx-kodene for alle år, men er bare fylt ut med reelle tall for
 * det (de) nyeste valget/valgene — trolig dekker den harmoniserte
 * omkodingen til dagens struktur bare et par valg tilbake, ikke hele
 * historikken til 1945.
 *
 * Løsning: prøv ALLE kjente kodevarianter (kode2024, koder2020, koder2019)
 * per kommune og år, og bruk den som faktisk har en nullforskjellig sum for
 * det året — i stedet for å anta én fast konvensjon som gjelder for alle
 * år. Selvkorrigerende uansett hvilken av variantene som viser seg å ha de
 * ekte tallene for et gitt år.
 *
 * Partinavn matches EKSAKT (ikke som delstreng) mot kjente offisielle navn,
 * fordi «Venstre» ellers ville truffet inni «Sosialistisk Venstreparti».
 */
import { SsbFeil, finnDim, flatUt, hentMeta, spor } from './px'
import type { Kommune } from './regioner'
import type { Valgrad } from './types'
import type { KildeContext, KildePayload } from './kilder'

const TABELL_KOMMUNESTYRE = '01180'
const FRA = 2011

/** Offisielle partinavn, eksakt (case-insensitive) — ikke delstreng. */
const PARTI_NAVN: Record<string, string[]> = {
  ap: ['arbeiderpartiet', 'det norske arbeiderparti'],
  h: ['høyre'],
  frp: ['fremskrittspartiet'],
  sp: ['senterpartiet'],
  sv: ['sosialistisk venstreparti'],
  v: ['venstre'],
  krf: ['kristelig folkeparti'],
  r: ['rødt'],
}
const NAVN_TIL_PARTI = new Map<string, string>()
for (const [parti, navn] of Object.entries(PARTI_NAVN)) {
  for (const n of navn) NAVN_TIL_PARTI.set(n, parti)
}

async function hentEttValg(
  valgtype: string,
  tabell: string,
  fra: number,
  til: number,
  kommuner: Kommune[]
): Promise<{ resultater: Valgrad[]; ar: number[]; advarsler: string[] }> {
  const advarsler: string[] = []
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region', 'Kommune', 'Kommuner'])
  const dimParti = finnDim(meta, ['Parti', 'Partier', 'parti', 'Parti/valgliste', 'PolitParti'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')

  const partiKoder = dimParti.values
    .map((kode, i) => ({ kode, parti: NAVN_TIL_PARTI.get((dimParti.valueTexts?.[i] ?? kode).trim().toLowerCase()) }))
    .filter((p): p is { kode: string; parti: string } => Boolean(p.parti))

  if (!partiKoder.length) {
    throw new SsbFeil(
      `Fant ingen av de åtte partiene i tabell ${tabell} sin partidimensjon. ` +
        `Faktiske navn: ${dimParti.valueTexts?.join(' | ') ?? dimParti.values.join(' | ')}. ` +
        `Rett PARTI_NAVN i lib/ssb/valg.ts til å matche disse.`
    )
  }
  const manglendePartier = Object.keys(PARTI_NAVN).filter((p) => !partiKoder.some((pk) => pk.parti === p))
  if (manglendePartier.length) {
    advarsler.push(`Tabell ${tabell}: fant ikke partiene ${manglendePartier.join(', ')} — utelatt fra resultatet.`)
  }

  let innholdKode: string | null = null
  let prosentDirekte = false
  if (dimInnhold) {
    const iProsent = dimInnhold.values.findIndex((v, idx) => /prosent/i.test(dimInnhold.valueTexts?.[idx] ?? v))
    if (iProsent !== -1) {
      innholdKode = dimInnhold.values[iProsent]
      prosentDirekte = true
    } else {
      const iStemmer = dimInnhold.values.findIndex((v, idx) => /stemmer/i.test(dimInnhold.valueTexts?.[idx] ?? v))
      if (iStemmer === -1) {
        throw new SsbFeil(
          `Tabell ${tabell} har en ContentsCode-dimensjon, men ingen verdi matcher «prosent» eller «stemmer». ` +
            `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
        )
      }
      innholdKode = dimInnhold.values[iStemmer]
    }
  }

  // Tabellen bruker IKKE én fast konvensjon for alle år (se kommentar øverst
  // — 2023 har ekte tall bare under kode2024, andre år har ekte tall under
  // en av de andre variantene, eller kode2024 med sum 0). Spør derfor om
  // UNIONEN av alle kjente kodevarianter, og la resultatløkken plukke
  // hvilken variant som faktisk har data for hvert kommune×år.
  const finnesRegion = new Set(dimRegion.values)
  const koderHer = [...new Set(kommuner.flatMap((k) => [k.kode2024, ...k.koder2020, ...k.koder2019]))].filter((k) =>
    finnesRegion.has(k)
  )
  if (!koderHer.length) {
    throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)
  }

  const finnesTid = new Set(dimTid.values)
  const arHer = dimTid.values.filter((y) => Number(y) >= fra && Number(y) <= til && finnesTid.has(y))
  if (!arHer.length) {
    throw new SsbFeil(
      `Ingen valgår mellom ${fra} og ${til} finnes i tabell ${tabell}. Tabellen dekker ${dimTid.values.join(', ')}.`
    )
  }

  // I prosent-modus trenger vi bare våre åtte partier. I stemmetall-modus
  // trenger vi ALLE partier, siden nevneren er summen av samtlige — å bare
  // summere våre åtte ville gitt en helt feil (for høy) prosentandel.
  const partiKoderForSporring = prosentDirekte
    ? partiKoder.map((p) => p.kode)
    : dimParti.values

  const raPerKodeArParti = new Map<string, number>() // `${kode}|${ar}|${parti}` → stemmer/andel
  const totalPerKodeAr = new Map<string, number>() // `${kode}|${ar}` → sum over ALLE partier
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: koderHer } },
        { code: dimParti.code, selection: { filter: 'item', values: partiKoderForSporring } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })
    const rader = flatUt(ds)
    for (const rad of rader) {
      const verdi = Number(rad.verdi) || 0
      const region = rad[dimRegion.code]
      if (!prosentDirekte) {
        totalPerKodeAr.set(`${region}|${y}`, (totalPerKodeAr.get(`${region}|${y}`) ?? 0) + verdi)
      }
      const parti = partiKoder.find((p) => p.kode === rad[dimParti.code])?.parti
      if (!parti) continue
      raPerKodeArParti.set(`${region}|${y}|${parti}`, verdi)
    }
  }

  const resultater: Valgrad[] = []
  for (const k of kommuner) {
    // Prøv alle kjente kodevarianter for denne kommunen, i denne rekkefølgen
    // — kode2024 er oftest riktig (nyeste valg), men ikke alltid (se
    // kommentaren øverst i fila).
    const kandidater = [...new Set([k.kode2024, ...k.koder2020, ...k.koder2019])].filter((c) => koderHer.includes(c))
    if (!kandidater.length) continue // meldt i «ingen av kommunekodene finnes» over, om aktuelt
    for (const yStr of arHer) {
      const y = Number(yStr)
      let beste: { kode: string; total: number | undefined } | null = null
      for (const kode of kandidater) {
        const harNoeParti = Object.keys(PARTI_NAVN).some((p) => raPerKodeArParti.has(`${kode}|${yStr}|${p}`))
        if (!harNoeParti) continue
        const total = totalPerKodeAr.get(`${kode}|${y}`)
        // Sammenlignet mot undefined ELLER 0 — en tom rad og en rad fylt med
        // nuller ser like ut for brukeren, og begge betyr «ingen reelle tall
        // her», selv om en (usannsynlig, men gyldig) ekte sum på 0 stemmer
        // ville blitt avvist for strengt av samme sjekk.
        const harTotal = prosentDirekte || (total !== undefined && total !== 0)
        if (harTotal) { beste = { kode, total }; break }
        if (!beste) beste = { kode, total } // husk beste treff så langt, til advarselen
      }
      if (!beste) {
        advarsler.push(`${k.key} ${valgtype} ${y}: ingen tall i tabell ${tabell} for noen kodevariant.`)
        continue
      }
      const { kode: brukt, total } = beste
      if (!prosentDirekte && (total === undefined || total === 0)) {
        advarsler.push(`${k.key} ${valgtype} ${y}: fant tall (kode ${brukt}), men ingen totalsum å regne prosent mot (${total ?? 'ingen rad'}).`)
        continue
      }
      for (const parti of Object.keys(PARTI_NAVN)) {
        const verdi = raPerKodeArParti.get(`${brukt}|${yStr}|${parti}`)
        if (verdi === undefined) continue
        const andel = prosentDirekte ? verdi : Number(((verdi / total!) * 100).toFixed(1))
        resultater.push([valgtype, k.key, y, parti, andel])
      }
    }
  }

  return { resultater, ar: arHer.map(Number), advarsler }
}

/** Kilde valg:01180 — kommunestyrevalg. */
export async function hentKildeKommunestyre(ctx: KildeContext): Promise<KildePayload> {
  const til = new Date().getUTCFullYear()
  const { resultater, advarsler } = await hentEttValg('kommune', TABELL_KOMMUNESTYRE, FRA, til, ctx.kommuner)
  return { kilde: `ssb:${TABELL_KOMMUNESTYRE}`, resultater, advarsler }
}
