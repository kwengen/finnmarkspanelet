/**
 * Kommuneøkonomi: netto driftsresultat og frie inntekter fra tabell 12134,
 * disposisjonsfond fra tabell 12143, netto lånegjeld fra tabell 12137.
 *
 * Første ekte kjøring viste at tabell 12134 ikke har «brutto driftsresultat»
 * — den har «Netto driftresultat i prosent av brutto driftsinntekter», som
 * er det vanlige hovednøkkeltallet for kommuneøkonomi uansett (mer brukt enn
 * bruttotallet). Rettet til å bruke det.
 *
 * Disposisjonsfond ble først forsøkt hentet fra 12137 (se historikken under
 * for lånegjeld) — men en ekte kjøring viste at 12137 sin fulle
 * Regnskapsbegrep-liste rett og slett IKKE inneholder disposisjonsfond i det
 * hele tatt: «Brutto driftsutgifter totalt | Korrigerte brutto
 * driftsutgifter totalt | Netto driftsutgifter totalt | Brutto
 * driftsinntekter i alt | Netto driftsresultat | Skatt på inntekt og formue
 * inkludert naturressursskatt | Rammetilskudd | Eiendomsskatt totalt | Frie
 * inntekter | Netto inntekt fra konsesjonskraft, kraftrettigheter og annen
 * kraft for videresalg | Brutto investeringsutgifter totalt | Netto
 * lånegjeld | Langsiktig gjeld ekskl. pensjonsforpliktelser |
 * Pensjonsforpliktelse». Flyttet i stedet til 12134 — panelet viser
 * disposisjonsfond som «% av driftsinntekter», ikke kr, så det passer
 * tematisk bedre sammen med driftsresultat (samme måleform, samme tabell)
 * enn med 12137 sine kr-baserte tall uansett.
 *
 * Netto lånegjeld per innbygger (kr) finnes fortsatt bare i tabell 12137
 * («Finansielle nøkkeltall fra bevilgnings- og balanseregnskapet i kroner
 * per innbygger, etter regnskapsbegrep»). Første ekte kjøring mot 12137
 * viste at ContentsCode der IKKE er indikatoren (slik den er i 12134) — den
 * har bare to generiske måleenheter, «Beløp per innbygger (kr)» og «Beløp
 * (1000 kr)». Det faktiske regnskapsbegrepet ligger i en egen
 * «Regnskapsbegrep»-dimensjon, bekreftet av selve tabelltittelen. Løst ved å
 * gi hentKostraIndikatorer() en valgfri fjerde parameter som peker
 * indikator-matchingen mot en annen dimensjon enn ContentsCode, og i så fall
 * låser ContentsCode til én fast måleenhet («per innbygger») i stedet.
 *
 * Hver indikator, og hver av de to tabellene, hentes og feiler uavhengig av
 * de andre — én som ikke finnes stopper ikke resten.
 */
import { finnDim, flatUt, hentMeta, spor, SsbFeil } from './px'
import { kodeneFor, type Kommune } from './regioner'
import type { Faktarad } from './types'
import { fjernIndikatorerUtenFullDekning } from './validate'
import type { KildeContext, KildePayload } from './kilder'

const TABELL = '12134'
const TABELL_DISPOSISJONSFOND = '12143'
const TABELL_NOKKELTALL = '12137'
const FRA = 2015

const INDIKATORER: Array<{ nokkel: string; match: (tekst: string) => boolean; beskrivelse: string }> = [
  { nokkel: 'driftsresultat', match: (t) => /netto\s*drifts?resultat/i.test(t), beskrivelse: 'netto driftsresultat' },
  { nokkel: 'frieinntekter', match: (t) => /frie\s*inntekter/i.test(t), beskrivelse: 'frie inntekter per innbygger' },
]

const INDIKATORER_DISPOSISJONSFOND: Array<{ nokkel: string; match: (tekst: string) => boolean; beskrivelse: string }> = [
  { nokkel: 'disposisjonsfond', match: (t) => /disposisjonsfond/i.test(t), beskrivelse: 'disposisjonsfond i prosent av brutto driftsinntekter' },
]

const INDIKATORER_NOKKELTALL: Array<{ nokkel: string; match: (tekst: string) => boolean; beskrivelse: string }> = [
  { nokkel: 'lanegjeld', match: (t) => /l[åa]negjeld/i.test(t), beskrivelse: 'netto lånegjeld per innbygger' },
]

/**
 * Når indikatorene IKKE ligger i ContentsCode (som i 12137, der ContentsCode
 * bare er måleenhet), peker dette til den dimensjonen som faktisk skiller
 * indikatorene fra hverandre, og til hvilken ContentsCode-verdi som skal
 * låses fast (måleenheten vi vil ha, f.eks. «per innbygger»).
 */
interface AlternativIndikatorDim {
  kandidater: string[]
  enhetMatch: (tekst: string) => boolean
  enhetBeskrivelse: string
}

/**
 * Henter en liste indikatorer fra én enkel region×tid×innhold-tabell, med
 * samme «konsern foretrekkes»-logikk som hentOkonomi() bruker mot 12134.
 * Egen funksjon fordi den nå brukes mot to forskjellige tabeller, som viste
 * seg å plassere selve indikatoren i to forskjellige dimensjoner (se
 * kommentaren øverst i fila).
 */
async function hentKostraIndikatorer(
  tabell: string,
  indikatorer: Array<{ nokkel: string; match: (tekst: string) => boolean; beskrivelse: string }>,
  ar: string[],
  kommuner: Kommune[],
  alternativIndikatorDim?: AlternativIndikatorDim
): Promise<{ fakta: Faktarad[]; advarsler: string[] }> {
  const advarsler: string[] = []
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')
  if (!dimInnhold) {
    throw new SsbFeil(`Tabell ${tabell} mangler en ContentsCode-dimensjon — kan ikke plukke ut enkeltindikatorer.`)
  }

  const dimIndikator = alternativIndikatorDim ? finnDim(meta, alternativIndikatorDim.kandidater) : dimInnhold

  let enhetKode: string | null = null
  if (alternativIndikatorDim) {
    const i = dimInnhold.values.findIndex((v, idx) => alternativIndikatorDim.enhetMatch(dimInnhold.valueTexts?.[idx] ?? v))
    if (i === -1) {
      throw new SsbFeil(
        `Fant ingen ContentsCode i tabell ${tabell} som matcher «${alternativIndikatorDim.enhetBeskrivelse}». ` +
          `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
      )
    }
    enhetKode = dimInnhold.values[i]
  }

  const dimNivaa = meta.variables.find((v) => /konsern|niv[åa]|sektor/i.test(v.text))
  const nivaaKode = dimNivaa
    ? dimNivaa.values.find((v, i) => /konsern/i.test(dimNivaa.valueTexts?.[i] ?? v))
    : null
  if (dimNivaa && !nivaaKode) {
    advarsler.push(
      `Tabell ${tabell} har dimensjonen «${dimNivaa.text}», men fant ingen verdi som matcher «konsern». ` +
        `Bruker første verdi (${dimNivaa.valueTexts?.[0] ?? dimNivaa.values[0]}) i stedet.`
    )
  }

  const innholdKoder = indikatorer.flatMap((ind) => {
    const i = dimIndikator.values.findIndex((v, idx) => ind.match(dimIndikator.valueTexts?.[idx] ?? v))
    if (i === -1) {
      advarsler.push(
        `${ind.beskrivelse}: fant ingen ${dimIndikator.text} i tabell ${tabell} som matcher. ` +
          `Tilgjengelige verdier: ${dimIndikator.valueTexts?.join(' | ') ?? dimIndikator.values.join(' | ')}.`
      )
      return []
    }
    return [{ ...ind, kode: dimIndikator.values[i] }]
  })
  if (!innholdKoder.length) {
    // Kaster her i stedet for å returnere tomt — men da forsvinner advarslene
    // over sammen med resten av det lokale resultatet. Ta dem med i selve
    // feilmeldingen, ellers ser den som leser feilen aldri hva som faktisk
    // finnes i tabellen.
    throw new SsbFeil(`Fant ingen av de forventede indikatorene i tabell ${tabell}:\n- ${advarsler.join('\n- ')}`)
  }

  const alleKoder = [...new Set(kommuner.flatMap((k) => [k.kode2024, ...k.koder2020, ...k.koder2019]))]
  const finnesRegion = new Set(dimRegion.values)
  const koderHer = alleKoder.filter((k) => finnesRegion.has(k))
  if (!koderHer.length) throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)

  const finnesTid = new Set(dimTid.values)
  const arHer = ar.filter((y) => finnesTid.has(y))
  if (!arHer.length) {
    throw new SsbFeil(
      `Ingen av årene ${ar.join(', ')} finnes i tabell ${tabell}. Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`
    )
  }

  const raPerKodeArInd = new Map<string, number>()
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: koderHer } },
        { code: dimIndikator.code, selection: { filter: 'item', values: innholdKoder.map((i) => i.kode) } },
        ...(alternativIndikatorDim ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [enhetKode!] } }] : []),
        ...(dimNivaa ? [{ code: dimNivaa.code, selection: { filter: 'item', values: [nivaaKode ?? dimNivaa.values[0]] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })
    for (const rad of flatUt(ds)) {
      const nokkel = innholdKoder.find((i) => i.kode === rad[dimIndikator.code])?.nokkel
      if (!nokkel) continue
      raPerKodeArInd.set(`${rad[dimRegion.code]}|${y}|${nokkel}`, Number(rad.verdi) || 0)
    }
  }

  const fakta: Faktarad[] = []
  for (const k of kommuner) {
    for (const yStr of arHer) {
      const y = Number(yStr)
      const brukt = kodeneFor(k, y).find((c) => innholdKoder.some((ind) => raPerKodeArInd.has(`${c}|${yStr}|${ind.nokkel}`)))
      if (!brukt) {
        advarsler.push(`${k.key} ${y}: ingen tall i tabell ${tabell}.`)
        continue
      }
      for (const ind of innholdKoder) {
        const verdi = raPerKodeArInd.get(`${brukt}|${yStr}|${ind.nokkel}`)
        if (verdi !== undefined) fakta.push([k.key, y, ind.nokkel, verdi])
      }
    }
  }

  return { fakta, advarsler }
}

function onskedeAr(): string[] {
  const til = new Date().getUTCFullYear()
  return Array.from({ length: til - FRA + 1 }, (_, i) => String(FRA + i))
}

/** Kilde okonomi:12134 — anker (driftsresultat/frieinntekter). */
export async function hentKildeHoved(ctx: KildeContext): Promise<KildePayload> {
  const { fakta, advarsler } = await hentKostraIndikatorer(TABELL, INDIKATORER, onskedeAr(), ctx.kommuner)
  return { kilde: `kostra:${TABELL}`, fakta, advarsler }
}

/** Kilde okonomi:12143 — disposisjonsfond i prosent av brutto driftsinntekter. */
export async function hentKildeDisposisjonsfond(ctx: KildeContext): Promise<KildePayload> {
  const { fakta, advarsler: hentAdvarsler } = await hentKostraIndikatorer(
    TABELL_DISPOSISJONSFOND,
    INDIKATORER_DISPOSISJONSFOND,
    onskedeAr(),
    ctx.kommuner,
    {
      kandidater: ['Regnskapsbegrep', 'regnskapsbegrep'],
      enhetMatch: (t) => /prosent/i.test(t),
      enhetBeskrivelse: 'prosent av brutto driftsinntekter',
    }
  )
  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(fakta)
  return {
    kilde: `kostra:${TABELL_DISPOSISJONSFOND}`,
    fakta: faktaFiltrert,
    advarsler: [
      ...hentAdvarsler,
      ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i de publiserte årene — filtrert bort.`),
    ],
  }
}

export async function hentKildeNokkeltall(ctx: KildeContext): Promise<KildePayload> {
  const hovedPayload = await ctx.lesKilde('okonomi:12134')
  const hovedAr = new Set((hovedPayload?.fakta ?? []).map(([, ar]) => ar))

  const { fakta, advarsler: hentAdvarsler } = await hentKostraIndikatorer(
    TABELL_NOKKELTALL, INDIKATORER_NOKKELTALL, onskedeAr(), ctx.kommuner,
    {
      kandidater: ['Regnskapsbegrep', 'regnskapsbegrep'],
      enhetMatch: (t) => /per innbygger/i.test(t),
      enhetBeskrivelse: 'beløp per innbygger (kr)',
    }
  )
  const advarsler = [...hentAdvarsler]
  if (!hovedPayload) {
    advarsler.push('lanegjeld: driftsresultat (okonomi:12134) er ikke hentet ennå — filtreres ikke mot dets årsspenn før den er hentet.')
  }
  const faktaMotHoved = hovedAr.size ? fakta.filter(([, ar]) => hovedAr.has(ar)) : fakta

  // Lånegjeld kommer fra en annen tabell enn driftsresultat/
  // frie inntekter, og kan derfor mangle et enkelt ferskt år tabellen ikke
  // har rukket å publisere ennå — det er greit, validate.ts sin dekningssjekk
  // ser nå bare på årene indikatoren selv har data for. Det som IKKE er
  // greit, er en indikator som mangler noen kommuner i et år den ellers har
  // data for — det er et tegn på en kommunekode som ikke matcher. Dropper vi
  // indikatoren helt her når det skjer, lagres resten
  // av temaet uansett, i stedet for at hele hentingen feiler.
  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(faktaMotHoved)
  advarsler.push(
    ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i alle publiserte år — filtrert bort.`)
  )

  return { kilde: `kostra:${TABELL_NOKKELTALL}`, fakta: faktaFiltrert, advarsler }
}
