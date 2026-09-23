/**
 * Næring og arbeidsplasser: sysselsatte, arbeidsplasser, pendlingsbalanse,
 * andel i kommunal sektor, antall foretak og sysselsettingsandel.
 *
 * Hver tabell er sin egen «kilde» (se lib/ssb/kilder.ts) og hentes/lagres
 * uavhengig — én feil tabell stopper ikke de andre. To av kildene leser en
 * ANNEN kildes hurtigbufrede tall som inndata (via ctx.lesKilde, en billig
 * databaselesning, IKKE et nytt SSB-kall):
 *  - andel_kommunal (11917) trenger sysselsatte (11616) sitt tall som nevner
 *    når 11917 ikke gir en ferdig prosentandel selv.
 *
 * Første ekte kjøring viste at den antatte tabellen for sysselsatte/
 * arbeidsplasser (07984) var feil, og at 11616 — som var gjettet for andel
 * offentlig sektor — faktisk ER riktig tabell for sysselsatte etter bosted
 * og arbeidssted, ikke for sektorfordeling. Rettet til å bruke 11616 for
 * begge.
 *
 * Tabell 11917 («Sysselsatte personer i kommunal sektor», kommunenivå)
 * dekker bare KOMMUNAL sektor, ikke offentlig sektor i sin helhet (som også
 * inkluderer fylkeskommunalt og statlig ansatte). Indikatoren er derfor
 * omdøpt fra «andel offentlig sektor» til «andel kommunal sektor» i
 * panelet, i stedet for å late som tallet dekker mer enn det gjør. Gir
 * tabellen ikke en ferdig andel, beregnes den fra sysselsatte bosatt
 * (11616) som nevner — samme mønster som valg.ts brukte for stemmeandeler.
 *
 * Første ekte kjøring brukte 11916, som viste seg å være FYLKESNIVÅ («…,
 * etter funksjon (F)») — ingen kommunekode traff i det hele tatt. 11917 er
 * søsjontabellen på kommunenivå.
 *
 * Sysselsettingsandel (06445, «Andel sysselsatte i befolkningen, etter
 * bosted, kjønn og alder») er normalisert mot befolkning i stedet for et
 * rått hodetall — sysselsatte-antallet i seg selv sier lite om Alta
 * (18 000 innbyggere) er «bedre» enn Loppa (500), mens andelen av
 * befolkningen som er sysselsatt er sammenlignbar på tvers av
 * kommunestørrelse. Tabellen har egne Kjønn- og Alder-dimensjoner —
 * «begge kjønn» og en samlekategori for alder velges, samme mønster som
 * andel_kommunal bruker for Kjønn.
 *
 * Foretak (07091) er fortsatt uverifisert mot en levende respons, men
 * korrobert av SSBs egen tabellbeskrivelse (bedrifter etter næring og antall
 * ansatte, kommunenivå).
 */
import { finnDim, flatUt, hentMeta, spor, SsbFeil } from './px'
import { kodeneFor, type Kommune } from './regioner'
import type { Faktarad } from './types'
import { fjernIndikatorerUtenFullDekning } from './validate'
import type { KildeContext, KildePayload } from './kilder'

const TABELL_SYSSELSATTE = '11616'
const TABELL_KOMMUNAL_SEKTOR = '11917'
const TABELL_FORETAK = '07091'
const TABELL_SYSSELSETTINGSANDEL = '06445'
const FRA = 2015

interface Uttrekk {
  raPerKodeAr: Map<string, number>
  advarsler: string[]
}

function onskedeAr(): string[] {
  const til = new Date().getUTCFullYear()
  return Array.from({ length: til - FRA + 1 }, (_, i) => String(FRA + i))
}

function alleKommunekoder(kommuner: Kommune[]): string[] {
  return [...new Set(kommuner.flatMap((k) => [k.kode2024, ...k.koder2020, ...k.koder2019]))]
}

/** Kommunekode → internnøkkel-oppløsning av en rå region×år-tabell, generisk per indikator. */
function tilFaktarad(nokkel: string, ra: Map<string, number>, kommuner: Kommune[], ar: string[]): Faktarad[] {
  const fakta: Faktarad[] = []
  for (const k of kommuner) {
    for (const yStr of ar) {
      const y = Number(yStr)
      const brukt = kodeneFor(k, y).find((c) => ra.has(`${c}|${yStr}`))
      if (!brukt) continue
      fakta.push([k.key, y, nokkel, ra.get(`${brukt}|${yStr}`)!])
    }
  }
  return fakta
}

/** Henter alle år for én indikator fra én enkel region×tid×innhold-tabell. */
async function hentPerKommuneAr(
  tabell: string,
  ar: string[],
  brukbareKoder: string[],
  innholdMatch: (tekst: string) => boolean,
  innholdBeskrivelse: string
): Promise<Uttrekk> {
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')

  const finnesRegion = new Set(dimRegion.values)
  const koderHer = brukbareKoder.filter((k) => finnesRegion.has(k))
  if (!koderHer.length) {
    throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)
  }

  const finnesTid = new Set(dimTid.values)
  const arHer = ar.filter((y) => finnesTid.has(y))
  if (!arHer.length) {
    throw new SsbFeil(
      `Ingen av årene ${ar.join(', ')} finnes i tabell ${tabell}. Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`
    )
  }

  let innholdKode: string | null = null
  if (dimInnhold) {
    const i = dimInnhold.values.findIndex((v, idx) => innholdMatch(dimInnhold.valueTexts?.[idx] ?? v))
    if (i === -1) {
      throw new SsbFeil(
        `Fant ingen ContentsCode i tabell ${tabell} som matcher «${innholdBeskrivelse}». ` +
          `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
      )
    }
    innholdKode = dimInnhold.values[i]
  }

  const raPerKodeAr = new Map<string, number>()
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: koderHer } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })
    for (const rad of flatUt(ds)) {
      raPerKodeAr.set(`${rad[dimRegion.code]}|${y}`, Number(rad.verdi) || 0)
    }
  }

  const advarsler: string[] = []

  return { raPerKodeAr, advarsler }
}

/**
 * Rådata for andel kommunal sektor, fra tabell 11917 — UTEN å regne om til
 * prosent. Ratioen regnes av kalleren (hentKildeKommunalSektor), som trenger
 * sysselsatte i internnøkkel-rom (k.key), ikke rå kommunekode-rom.
 */
async function hentAndelKommunalSektorRadata(
  ar: string[],
  brukbareKoder: string[]
): Promise<Uttrekk & { erAndelDirekte: boolean }> {
  const tabell = TABELL_KOMMUNAL_SEKTOR
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')
  const dimKjonn = meta.variables.find((v) => /kj[øo]nn/i.test(v.text))

  const finnesRegion = new Set(dimRegion.values)
  const koderHer = brukbareKoder.filter((k) => finnesRegion.has(k))
  if (!koderHer.length) throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)

  const finnesTid = new Set(dimTid.values)
  const arHer = ar.filter((y) => finnesTid.has(y))
  if (!arHer.length) {
    throw new SsbFeil(`Ingen av årene ${ar.join(', ')} finnes i tabell ${tabell}. Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`)
  }

  const kjonnKode = dimKjonn
    ? dimKjonn.values.find((v, i) => /begge|i alt|alle/i.test(dimKjonn.valueTexts?.[i] ?? v)) ?? dimKjonn.values[0]
    : null

  let innholdKode: string | null = null
  let erAndelDirekte = false
  if (dimInnhold) {
    const iAndel = dimInnhold.values.findIndex((v, idx) => /andel|prosent/i.test(dimInnhold.valueTexts?.[idx] ?? v))
    if (iAndel !== -1) {
      innholdKode = dimInnhold.values[iAndel]
      erAndelDirekte = true
    } else {
      const iAntall = dimInnhold.values.findIndex((v, idx) => /sysselsatte|kommunal/i.test(dimInnhold.valueTexts?.[idx] ?? v))
      innholdKode = dimInnhold.values[iAntall !== -1 ? iAntall : 0]
    }
  }

  const raPerKodeAr = new Map<string, number>()
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: koderHer } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        ...(dimKjonn && kjonnKode ? [{ code: dimKjonn.code, selection: { filter: 'item', values: [kjonnKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })
    for (const rad of flatUt(ds)) {
      raPerKodeAr.set(`${rad[dimRegion.code]}|${y}`, Number(rad.verdi) || 0)
    }
  }

  const advarsler: string[] = []
  if (!erAndelDirekte) {
    advarsler.push(`Tabell ${tabell} ga ikke en ferdig andel — beregnet mot sysselsatte bosatt fra tabell ${TABELL_SYSSELSATTE}.`)
  }

  return { raPerKodeAr, advarsler, erAndelDirekte }
}

/**
 * Andel av befolkningen (bosatt) som er sysselsatt, fra tabell 06445.
 *
 * Har tabellen egne Kjønn- og Alder-dimensjoner, velges «begge kjønn» og en
 * samlealder («i alt»/«15-74 år») — samme mønster som
 * hentAndelKommunalSektorRadata() bruker for Kjønn.
 */
async function hentSysselsettingsandel(ar: string[], brukbareKoder: string[]): Promise<Uttrekk> {
  const tabell = TABELL_SYSSELSETTINGSANDEL
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')
  const dimKjonn = meta.variables.find((v) => /kj[øo]nn/i.test(v.text))
  const dimAlder = meta.variables.find((v) => /alder/i.test(v.text))

  const finnesRegion = new Set(dimRegion.values)
  const koderHer = brukbareKoder.filter((k) => finnesRegion.has(k))
  if (!koderHer.length) throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)

  const finnesTid = new Set(dimTid.values)
  const arHer = ar.filter((y) => finnesTid.has(y))
  if (!arHer.length) {
    throw new SsbFeil(`Ingen av årene ${ar.join(', ')} finnes i tabell ${tabell}. Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`)
  }

  const kjonnKode = dimKjonn
    ? dimKjonn.values.find((v, i) => /begge|i alt|alle/i.test(dimKjonn.valueTexts?.[i] ?? v)) ?? dimKjonn.values[0]
    : null
  const alderKode = dimAlder
    ? dimAlder.values.find((v, i) => /i alt|15-74|totalt/i.test(dimAlder.valueTexts?.[i] ?? v)) ?? dimAlder.values[0]
    : null

  let innholdKode: string | null = null
  if (dimInnhold) {
    const iAndel = dimInnhold.values.findIndex((v, idx) => /andel|prosent/i.test(dimInnhold.valueTexts?.[idx] ?? v))
    if (iAndel === -1) {
      throw new SsbFeil(
        `Fant ingen ContentsCode i tabell ${tabell} som matcher «andel/prosent». ` +
          `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
      )
    }
    innholdKode = dimInnhold.values[iAndel]
  }

  const raPerKodeAr = new Map<string, number>()
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: koderHer } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        ...(dimKjonn && kjonnKode ? [{ code: dimKjonn.code, selection: { filter: 'item', values: [kjonnKode] } }] : []),
        ...(dimAlder && alderKode ? [{ code: dimAlder.code, selection: { filter: 'item', values: [alderKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })
    for (const rad of flatUt(ds)) {
      raPerKodeAr.set(`${rad[dimRegion.code]}|${y}`, Number(rad.verdi) || 0)
    }
  }

  const advarsler: string[] = []

  return { raPerKodeAr, advarsler }
}

/** Kilde naering:11616 — anker (sysselsatte/arbeidsplasser/pendlingsbalanse, alt fra samme tabell). */
export async function hentKildeSysselsatte(ctx: KildeContext): Promise<KildePayload> {
  const kommuner = ctx.kommuner
  const ar = onskedeAr()
  const koder = alleKommunekoder(kommuner)

  const sysselsatte = await hentPerKommuneAr(
    TABELL_SYSSELSATTE, ar, koder,
    (t) => /sysselsatte.*bosatt/i.test(t), 'sysselsatte bosatt i regionen'
  )
  const advarsler = [...sysselsatte.advarsler]
  let arbeidsplasser: Uttrekk = { raPerKodeAr: new Map(), advarsler: [] }
  try {
    arbeidsplasser = await hentPerKommuneAr(
      TABELL_SYSSELSATTE, ar, koder,
      (t) => /sysselsatte.*arbeidssted/i.test(t), 'sysselsatte med arbeidssted i regionen'
    )
  } catch (e) {
    advarsler.push(`sysselsatte med arbeidssted i regionen: ${e instanceof Error ? e.message : String(e)}`)
  }
  advarsler.push(...arbeidsplasser.advarsler)

  const arMedSysselsatte = new Set([...sysselsatte.raPerKodeAr.keys()].map((k) => k.split('|')[1]))
  const felleAr = ar.filter((y) => arMedSysselsatte.has(y))

  const fakta: Faktarad[] = []
  for (const k of kommuner) {
    for (const yStr of felleAr) {
      const y = Number(yStr)
      const brukt = kodeneFor(k, y).find((c) => sysselsatte.raPerKodeAr.has(`${c}|${yStr}`))
      if (!brukt) {
        advarsler.push(`${k.key} ${y}: ingen tall i tabell ${TABELL_SYSSELSATTE}.`)
        continue
      }
      const syss = sysselsatte.raPerKodeAr.get(`${brukt}|${yStr}`)!
      const arbp = arbeidsplasser.raPerKodeAr.get(`${brukt}|${yStr}`)
      fakta.push([k.key, y, 'sysselsatte', syss])
      if (arbp !== undefined) {
        fakta.push([k.key, y, 'arbeidsplasser', arbp])
        if (syss > 0) fakta.push([k.key, y, 'pendlingsbalanse', Number(((arbp / syss) * 100).toFixed(1))])
      }
    }
  }

  return { kilde: `ssb:${TABELL_SYSSELSATTE}`, fakta, advarsler }
}

/** Kilde naering:11917 — leser naering:11616 sitt hurtigbufrede tall som nevner. */
export async function hentKildeKommunalSektor(ctx: KildeContext): Promise<KildePayload> {
  const kommuner = ctx.kommuner
  const ar = onskedeAr()
  const koder = alleKommunekoder(kommuner)

  const sysselsattePayload = await ctx.lesKilde('naering:11616')
  const sysselsatteByKey = new Map<string, number>()
  for (const [region, aar, ind, verdi] of sysselsattePayload?.fakta ?? []) {
    if (ind === 'sysselsatte') sysselsatteByKey.set(`${region}|${aar}`, verdi)
  }

  const { raPerKodeAr, advarsler: hentAdvarsler, erAndelDirekte } = await hentAndelKommunalSektorRadata(ar, koder)
  const advarsler = [...hentAdvarsler]
  if (!sysselsattePayload && !erAndelDirekte) {
    advarsler.push(
      `andel_kommunal: sysselsatte (naering:11616) er ikke hentet ennå — kan ikke beregne andel før den er hentet.`
    )
  }

  const fakta: Faktarad[] = []
  for (const k of kommuner) {
    for (const yStr of ar) {
      const y = Number(yStr)
      const brukt = kodeneFor(k, y).find((c) => raPerKodeAr.has(`${c}|${yStr}`))
      if (!brukt) continue
      const rå = raPerKodeAr.get(`${brukt}|${yStr}`)!
      if (erAndelDirekte) {
        fakta.push([k.key, y, 'andel_kommunal', rå])
      } else {
        const nevner = sysselsatteByKey.get(`${k.key}|${y}`)
        if (nevner) fakta.push([k.key, y, 'andel_kommunal', Number(((rå / nevner) * 100).toFixed(1))])
      }
    }
  }

  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(fakta)
  advarsler.push(
    ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i alle år ${FRA}–${new Date().getUTCFullYear()} — forblir demodata for hele perioden.`)
  )
  return { kilde: `ssb:${TABELL_KOMMUNAL_SEKTOR}`, fakta: faktaFiltrert, advarsler }
}

/** Kilde naering:07091 — antall foretak, uverifisert mot en levende respons. */
export async function hentKildeForetak(ctx: KildeContext): Promise<KildePayload> {
  const kommuner = ctx.kommuner
  const ar = onskedeAr()
  const koder = alleKommunekoder(kommuner)
  const { raPerKodeAr, advarsler } = await hentPerKommuneAr(TABELL_FORETAK, ar, koder, () => true, 'antall foretak')
  const fakta = tilFaktarad('foretak', raPerKodeAr, kommuner, ar)
  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(fakta)
  advarsler.push(
    ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i alle år ${FRA}–${new Date().getUTCFullYear()} — forblir demodata for hele perioden.`)
  )
  return { kilde: `ssb:${TABELL_FORETAK}`, fakta: faktaFiltrert, advarsler }
}

/** Kilde naering:06445 — sysselsettingsandel, normalisert mot befolkning. */
export async function hentKildeSysselsettingsandel(ctx: KildeContext): Promise<KildePayload> {
  const kommuner = ctx.kommuner
  const ar = onskedeAr()
  const koder = alleKommunekoder(kommuner)
  const { raPerKodeAr, advarsler } = await hentSysselsettingsandel(ar, koder)
  const fakta = tilFaktarad('sysselsettingsandel', raPerKodeAr, kommuner, ar)
  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(fakta)
  advarsler.push(
    ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i alle år ${FRA}–${new Date().getUTCFullYear()} — forblir demodata for hele perioden.`)
  )
  return { kilde: `ssb:${TABELL_SYSSELSETTINGSANDEL}`, fakta: faktaFiltrert, advarsler }
}
