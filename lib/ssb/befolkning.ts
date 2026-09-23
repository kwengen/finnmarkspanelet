/**
 * Befolkning etter kjønn og alder, fra SSB-tabell 07459, og
 * fødselsoverskudd/nettoflytting fra 01223.
 *
 * To valg er bevisste for 07459:
 *
 * 1. Vi henter ETTÅRIG alder og summerer til femårsgrupper selv. SSB har egne
 *    aggregatkoder, men de er ikke like på tvers av tabeller og kan endres.
 *    Egen summering gir samme svar hver gang, og lar oss regne andel 67+ og
 *    andel 0–19 eksakt — 67 er ikke en femårsgrense.
 *
 * 2. For hvert år brukes kommunekoden som GJALDT det året. En kommune kan
 *    ligge i tabellen under flere koder samtidig; å summere dem ville
 *    dobbelttalt. Hvis en annen kode likevel har tall, sier vi fra i stedet
 *    for å velge i stillhet.
 *
 * Hver tabell er sin egen «kilde» (se lib/ssb/kilder.ts) og hentes/lagres
 * uavhengig — 01223 kan feile eller mangle uten at 07459 blir rørt.
 */
import { SsbFeil, finnDim, flatUt, hentJson, hentMeta, spor } from './px'
import { kodeneFor, type Kommune } from './regioner'
import type { Faktarad, Sammenligningsrad, Strukturrad } from './types'
import { fjernIndikatorerUtenFullDekning } from './validate'
import type { KildeContext, KildePayload } from './kilder'

const TABELL = '07459'
const LANDSKODE = '0'
const TABELL_SAMMENLIGNINGER = '07459'
const TABELL_ENDRINGER = '01223'
const FRA = 2015

export const ALDERSBAND = (() => {
  const b: Array<{ key: string; lo: number }> = []
  for (let a = 0; a < 90; a += 5) b.push({ key: `${a}_${a + 4}`, lo: a })
  b.push({ key: '90p', lo: 90 })
  return b
})()

const bandFor = (alder: number) =>
  alder >= 90 ? '90p' : `${Math.floor(alder / 5) * 5}_${Math.floor(alder / 5) * 5 + 4}`

/**
 * Fødselsoverskudd og nettoflytting, fra tabell 01223.
 *
 * Ikke verifisert mot en levende respons — funnet via websøk. Tabellen ser
 * ut til å være KVARTALSVIS («hittil i år»), i motsetning til 07459 som er
 * årlig. Q4 er da helårstallet (kumulert gjennom hele året), og brukes som
 * årsverdi. Er tidsdimensjonen likevel årlig når det faktisk testes,
 * fungerer koden uendret — den sjekker selv om «ÅRK4»-formen finnes.
 *
 * Fødselsoverskudd = fødte − døde, regnet ut her (finnes neppe som egen
 * ContentsCode). Nettoflytting forventes å finnes direkte.
 */
async function hentBefolkningsendringer(
  ar: string[],
  kommuner: Kommune[]
): Promise<{ fakta: Faktarad[]; advarsler: string[] }> {
  const tabell = TABELL_ENDRINGER
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region', 'Kommune', 'Kommuner'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År', 'Kvartal'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')
  if (!dimInnhold) throw new SsbFeil(`Tabell ${tabell} mangler en ContentsCode-dimensjon.`)

  const iFodte = dimInnhold.values.findIndex((v, i) => /f[øo]dde|f[øo]dte/i.test(dimInnhold.valueTexts?.[i] ?? v))
  const iDode = dimInnhold.values.findIndex((v, i) => /d[øo]de/i.test(dimInnhold.valueTexts?.[i] ?? v))
  const iNetto = dimInnhold.values.findIndex((v, i) => /nettoinnflytting|nettoflytting/i.test(dimInnhold.valueTexts?.[i] ?? v))
  if (iFodte === -1 || iDode === -1) {
    throw new SsbFeil(
      `Fant ikke «fødte» og «døde» i tabell ${tabell} sin ContentsCode. ` +
        `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
    )
  }
  if (iNetto === -1) {
    throw new SsbFeil(
      `Fant ikke «nettoinnflytting»/«nettoflytting» i tabell ${tabell} sin ContentsCode. ` +
        `Tilgjengelige verdier: ${dimInnhold.valueTexts?.join(' | ') ?? dimInnhold.values.join(' | ')}.`
    )
  }
  const innholdKoder = [dimInnhold.values[iFodte], dimInnhold.values[iDode], dimInnhold.values[iNetto]]

  const alleKoder = [...new Set(kommuner.flatMap((k) => [k.kode2024, ...k.koder2020, ...k.koder2019]))]
  const finnesRegion = new Set(dimRegion.values)
  const brukbareKoder = alleKoder.filter((k) => finnesRegion.has(k))
  if (!brukbareKoder.length) throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${tabell}.`)

  // «ÅRK4» = fjerde kvartal = helårstallet, hvis tidsdimensjonen er kvartalsvis.
  // Er den ikke det, brukes året direkte.
  const erKvartalsvis = dimTid.values.some((v) => /^\d{4}K\d$/.test(v))
  const finnesTid = new Set(dimTid.values)
  const tidFor = (y: string) => (erKvartalsvis ? `${y}K4` : y)
  const arHer = ar.filter((y) => finnesTid.has(tidFor(y)))
  if (!arHer.length) {
    throw new SsbFeil(
      `Ingen av årene ${ar.join(', ')} finnes i tabell ${tabell} (som «${tidFor(ar[0])}» eller lignende). ` +
        `Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`
    )
  }

  const advarsler: string[] = []

  const raPerKodeArInnhold = new Map<string, number>() // `${kode}|${ar}|${innholdKode}` → verdi
  for (const y of arHer) {
    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: brukbareKoder } },
        { code: 'ContentsCode', selection: { filter: 'item', values: innholdKoder } },
        { code: dimTid.code, selection: { filter: 'item', values: [tidFor(y)] } },
      ],
      response: { format: 'json-stat2' },
    })
    for (const rad of flatUt(ds)) {
      raPerKodeArInnhold.set(`${rad[dimRegion.code]}|${y}|${rad.ContentsCode}`, Number(rad.verdi) || 0)
    }
  }

  const fakta: Faktarad[] = []
  for (const k of kommuner) {
    for (const y of arHer) {
      const brukt = kodeneFor(k, Number(y)).find((c) => raPerKodeArInnhold.has(`${c}|${y}|${innholdKoder[0]}`))
      if (!brukt) {
        advarsler.push(`${k.key} ${y}: ingen tall i tabell ${tabell}.`)
        continue
      }
      const fodte = raPerKodeArInnhold.get(`${brukt}|${y}|${innholdKoder[0]}`)
      const dode = raPerKodeArInnhold.get(`${brukt}|${y}|${innholdKoder[1]}`)
      const netto = raPerKodeArInnhold.get(`${brukt}|${y}|${innholdKoder[2]}`)
      if (fodte !== undefined && dode !== undefined) {
        fakta.push([k.key, Number(y), 'fodselsoverskudd', fodte - dode])
      }
      if (netto !== undefined) {
        fakta.push([k.key, Number(y), 'nettoflytting', netto])
      }
    }
  }

  return { fakta, advarsler }
}

/** Kilde befolkning:01223 — best-effort, feiler uavhengig av 07459. */
export async function hentKildeEndringer(ctx: KildeContext): Promise<KildePayload> {
  const fra = FRA
  const til = new Date().getUTCFullYear()
  const onskedeAr = Array.from({ length: til - fra + 1 }, (_, i) => String(fra + i))
  const { fakta, advarsler } = await hentBefolkningsendringer(onskedeAr, ctx.kommuner)
  // Tabell 01223 kan mangle et enkelt ferskt år den ikke har rukket å
  // publisere ennå — det er greit, dekningssjekken bryr seg bare om årene
  // indikatoren selv har data for. Mangler den derimot noen KOMMUNER i et år
  // den ellers dekker, er det et tegn på en kommunekode som ikke matcher, og
  // hele indikatoren droppes (forblir demodata) i stedet for å leveres med hull.
  const { fakta: faktaFiltrert, droppet } = fjernIndikatorerUtenFullDekning(fakta)
  return {
    kilde: `ssb:${TABELL_ENDRINGER}`,
    fakta: faktaFiltrert,
    advarsler: [
      ...advarsler,
      ...droppet.map((ind) => `${ind}: dekker ikke alle kommuner i alle år ${fra}–${til} — forblir demodata for hele perioden.`),
    ],
  }
}

/** Kilde befolkning:07459 — anker for temaet (folkemengde/andel0_19/andel67/aldersfordeling). */
export async function hentKildeStruktur(ctx: KildeContext): Promise<KildePayload> {
  const fra = FRA
  const til = new Date().getUTCFullYear()
  const kommuner = ctx.kommuner
  const advarsler: string[] = []

  const meta = await hentMeta(TABELL)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimKjonn = finnDim(meta, ['Kjonn', 'Kjønn', 'Sex'])
  const dimAlder = finnDim(meta, ['Alder', 'Age'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')

  /* ── Hvilke koder og år tabellen faktisk har ───────────────────────────── */
  const alleKoder = [...new Set(kommuner.flatMap((k) => [k.kode2024, ...k.koder2020, ...k.koder2019]))]
  const finnesRegion = new Set(dimRegion.values)
  const brukbareKoder = alleKoder.filter((k) => finnesRegion.has(k))
  const ukjente = alleKoder.filter((k) => !finnesRegion.has(k))
  if (ukjente.length) {
    advarsler.push(`Tabell ${TABELL} kjenner ikke kommunekodene ${ukjente.join(', ')}. De hoppes over.`)
  }
  if (!brukbareKoder.length) {
    throw new SsbFeil(`Ingen av Finnmark-kommunekodene finnes i tabell ${TABELL}.`)
  }
  if (!finnesRegion.has(LANDSKODE)) {
    throw new SsbFeil(`Tabell ${TABELL} mangler regionen «Hele landet» (kode ${LANDSKODE}).`)
  }
  const regionKoder = [...brukbareKoder, LANDSKODE]

  const finnesTid = new Set(dimTid.values)
  const onskedeAr = Array.from({ length: til - fra + 1 }, (_, i) => String(fra + i))
  const ar = onskedeAr.filter((y) => finnesTid.has(y))
  const manglendeAr = onskedeAr.filter((y) => !finnesTid.has(y))
  if (manglendeAr.length) {
    advarsler.push(`Tabell ${TABELL} har ikke årene ${manglendeAr.join(', ')}.`)
  }
  if (!ar.length) {
    throw new SsbFeil(
      `Ingen av årene ${fra}–${til} finnes i tabell ${TABELL}. ` +
        `Tabellen dekker ${dimTid.values[0]}–${dimTid.values.at(-1)}.`
    )
  }

  /* Ettårig alder er tresifret ("000", "001", …). Aggregatkoder og «uoppgitt»
     ser annerledes ut og skal ikke være med. */
  const alderKoder = dimAlder.values.filter((v) => /^\d{3}$/.test(v) && Number(v) <= 130)
  if (alderKoder.length < 90) {
    throw new SsbFeil(
      `Tabell ${TABELL} har bare ${alderKoder.length} ettårige alderskoder. ` +
        `Den ser ut til å bruke aldersgrupper, og kan ikke brukes til aldersstruktur.`
    )
  }

  const kjonnKart: Record<string, 'm' | 'k'> = {}
  dimKjonn.values.forEach((v, i) => {
    const t = (dimKjonn.valueTexts?.[i] ?? '').toLowerCase()
    if (t.startsWith('mann') || t.startsWith('menn')) kjonnKart[v] = 'm'
    else if (t.startsWith('kvinn')) kjonnKart[v] = 'k'
  })
  if (Object.keys(kjonnKart).length !== 2) {
    throw new SsbFeil(`Klarte ikke å tolke kjønnsdimensjonen i ${TABELL}: ${JSON.stringify(dimKjonn.valueTexts)}`)
  }

  const innholdKode = dimInnhold
    ? dimInnhold.values.find((v, i) => /personer/i.test(dimInnhold.valueTexts?.[i] ?? v)) ?? dimInnhold.values[0]
    : null

  /* ── Hent, ett år av gangen ────────────────────────────────────────────── */
  const raBand = new Map<string, number>() // kode|år|kjønn|bånd
  const raSum = new Map<string, number>() // kode|år
  const raAldersgrupper = new Map<string, { under20: number; over67: number }>()

  for (const y of ar) {
    const ds = await spor(TABELL, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: regionKoder } },
        { code: dimKjonn.code, selection: { filter: 'item', values: Object.keys(kjonnKart) } },
        { code: dimAlder.code, selection: { filter: 'item', values: alderKoder } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })

    for (const rad of flatUt(ds)) {
      const kjonn = kjonnKart[rad[dimKjonn.code]]
      if (!kjonn) continue
      const kode = rad[dimRegion.code]
      const alder = Number(rad[dimAlder.code])
      const antall = Number(rad.verdi) || 0

      const bk = `${kode}|${y}|${kjonn}|${bandFor(alder)}`
      raBand.set(bk, (raBand.get(bk) ?? 0) + antall)
      raSum.set(`${kode}|${y}`, (raSum.get(`${kode}|${y}`) ?? 0) + antall)

      const ak = `${kode}|${y}`
      const a = raAldersgrupper.get(ak) ?? { under20: 0, over67: 0 }
      if (alder <= 19) a.under20 += antall
      if (alder >= 67) a.over67 += antall
      raAldersgrupper.set(ak, a)
    }
  }

  /* ── Sett sammen per kommune og år ─────────────────────────────────────── */
  const befolkning: Strukturrad[] = []
  const fakta: Faktarad[] = []
  const kodebruk: Record<string, Record<number, string[]>> = {}

  for (const k of kommuner) {
    kodebruk[k.key] = {}
    for (const yStr of ar) {
      const y = Number(yStr)
      const gjeldende = kodeneFor(k, y).filter((c) => brukbareKoder.includes(c))
      const medData = gjeldende.filter((c) => (raSum.get(`${c}|${yStr}`) ?? 0) > 0)
      const andreMedData = [k.kode2024, ...k.koder2020, ...k.koder2019].filter(
        (c) => !gjeldende.includes(c) && (raSum.get(`${c}|${yStr}`) ?? 0) > 0
      )

      let brukt = medData
      if (!brukt.length && andreMedData.length) {
        brukt = andreMedData
        advarsler.push(
          `${k.key} ${y}: gjeldende kode ${gjeldende.join('+') || '(ingen)'} har ingen tall. ` +
            `Bruker ${andreMedData.join('+')} — kontroller at tabellen er omkodet.`
        )
      } else if (brukt.length && andreMedData.length) {
        advarsler.push(
          `${k.key} ${y}: både ${brukt.join('+')} og ${andreMedData.join('+')} har tall. ` +
            `Bruker gjeldende kode for å unngå dobbelttelling.`
        )
      }
      if (!brukt.length) {
        advarsler.push(`${k.key} ${y}: ingen tall i tabell ${TABELL}.`)
        continue
      }
      kodebruk[k.key][y] = brukt

      let total = 0
      for (const kjonn of ['m', 'k'] as const) {
        for (const b of ALDERSBAND) {
          const antall = brukt.reduce((s, c) => s + (raBand.get(`${c}|${yStr}|${kjonn}|${b.key}`) ?? 0), 0)
          befolkning.push([k.key, y, kjonn, b.key, antall])
          total += antall
        }
      }

      const agg = brukt.reduce(
        (a, c) => {
          const v = raAldersgrupper.get(`${c}|${yStr}`) ?? { under20: 0, over67: 0 }
          return { under20: a.under20 + v.under20, over67: a.over67 + v.over67 }
        },
        { under20: 0, over67: 0 }
      )

      fakta.push([k.key, y, 'folkemengde', total])
      if (total > 0) {
        fakta.push([k.key, y, 'andel0_19', Number(((agg.under20 / total) * 100).toFixed(1))])
        fakta.push([k.key, y, 'andel67', Number(((agg.over67 / total) * 100).toFixed(1))])
      }
    }
  }

  const sammenligninger: Sammenligningsrad[] = []
  for (const yStr of ar) {
    for (const band of ALDERSBAND) {
      const antall = (raBand.get(`${LANDSKODE}|${yStr}|m|${band.key}`) ?? 0) +
        (raBand.get(`${LANDSKODE}|${yStr}|k|${band.key}`) ?? 0)
      sammenligninger.push(['__norge', Number(yStr), band.key, antall])
    }
  }

  return {
    kilde: `ssb:${TABELL}`,
    aldersbaand: ALDERSBAND.map((b) => b.key),
    fakta,
    befolkning,
    sammenligninger,
    kodebruk,
    advarsler,
  }
}


/** Første år med SSBs nåværende sentralitetsinndeling i seks klasser. */
const FRA_SENTRALITET = 2018

interface KlassKorrespondanse {
  correspondenceItems?: Array<{ sourceCode: string; targetCode: string }>
}

/**
 * Henter SSBs offisielle kommune → sentralitetsklasse-kart for ett år.
 * KLASS kan publisere årets befolkning før årets korrespondanse; da brukes
 * siste tilgjengelige klassifisering bakover i tid.
 */
async function hentSentralitetskart(ar: number): Promise<Map<string, string>> {
  for (let klassAr = ar; klassAr >= FRA_SENTRALITET; klassAr -= 1) {
    const url =
      'https://data.ssb.no/api/klass/v1/classifications/131/correspondsAt' +
      `?targetClassificationId=128&date=${klassAr}-01-01`
    // KLASS deler SSBs utgående IP-kvote med PxWeb-kallene. Bruk den samme
    // køen og 429-håndteringen som resten av SSB-klienten.
    const data = (await hentJson(url)) as KlassKorrespondanse
    const kart = new Map<string, string>()
    for (const rad of data.correspondenceItems ?? []) {
      const klasse = String(Number(rad.targetCode))
      if (/^\d{4}$/.test(rad.sourceCode) && /^[1-6]$/.test(klasse)) kart.set(rad.sourceCode, klasse)
    }
    if (kart.size) return kart
  }
  throw new SsbFeil(`KLASS ga ingen kommuneinndeling i sentralitetsklasse 1–6 for ${ar}.`)
}

/**
 * Nasjonale aldersreferanser etter SSBs sentralitetsklasse 1–6.
 *
 * Klassifiseringen hentes fra KLASS for hvert år, eller fra siste publiserte\n * år når befolkningstabellen ligger foran KLASS. Deretter hentes
 * aldersfordelingen for alle kommunene som gjaldt det året fra tabell 07459
 * og summeres per klasse. Dermed følger tidsserien både kommuneendringer og
 * SSBs offisielle klassifisering, uten en lokal medlemsliste.
 *
 * Seksnivåinndelingen finnes fra 2018. Norge-serien hentes allerede direkte
 * fra samme tabell i hentKildeStruktur og dekker også tidligere år.
 */
export async function hentKildeSammenligninger(_ctx: KildeContext): Promise<KildePayload> {
  const tabell = TABELL_SAMMENLIGNINGER
  const meta = await hentMeta(tabell)
  const dimRegion = finnDim(meta, ['Region', 'Regioner', 'region'])
  const dimKjonn = finnDim(meta, ['Kjonn', 'Kjønn', 'Sex'])
  const dimAlder = finnDim(meta, ['Alder', 'Age'])
  const dimTid = finnDim(meta, ['Tid', 'Time', 'År'])
  const dimInnhold = meta.variables.find((v) => v.code === 'ContentsCode')

  const kjonnKoder = dimKjonn.values.filter((v, i) =>
    /mann|menn|kvinn/i.test(dimKjonn.valueTexts?.[i] ?? v)
  )
  if (kjonnKoder.length !== 2) {
    throw new SsbFeil(`Klarte ikke å tolke kjønnsdimensjonen i ${tabell}: ${JSON.stringify(dimKjonn.valueTexts)}`)
  }

  const alderKoder = dimAlder.values.flatMap((kode, i) => {
    const tekst = dimAlder.valueTexts?.[i] ?? kode
    const fraTekst = tekst.match(/^(\d+)\s*(?:år)?$/i)
    const fraKode = kode.match(/^0*(\d{1,3})$/)
    const alder = Number(fraTekst?.[1] ?? fraKode?.[1])
    return Number.isInteger(alder) && alder >= 0 && alder <= 130 ? [{ kode, alder }] : []
  })
  if (alderKoder.length < 90) {
    throw new SsbFeil(`Tabell ${tabell} har bare ${alderKoder.length} ettårige alderskoder.`)
  }
  const kodeTilAlder = new Map(alderKoder.map((a) => [a.kode, a.alder]))

  const finnesTid = new Set(dimTid.values)
  const til = new Date().getUTCFullYear()
  const onskedeAr = Array.from({ length: til - FRA_SENTRALITET + 1 }, (_, i) => String(FRA_SENTRALITET + i))
  const ar = onskedeAr.filter((y) => finnesTid.has(y))
  if (!ar.length) throw new SsbFeil(`Ingen år fra ${FRA_SENTRALITET} finnes i tabell ${tabell}.`)

  const innholdKode = dimInnhold
    ? dimInnhold.values.find((v, i) => /person/i.test(dimInnhold.valueTexts?.[i] ?? v)) ?? dimInnhold.values[0]
    : null
  const finnesRegion = new Set(dimRegion.values)
  const sammenligninger: Sammenligningsrad[] = []

  for (const y of ar) {
    const klassePerKommune = await hentSentralitetskart(Number(y))
    const kommuneKoder = [...klassePerKommune.keys()].filter((kode) => finnesRegion.has(kode))
    if (kommuneKoder.length < 300) {
      throw new SsbFeil(`Bare ${kommuneKoder.length} kommuner kunne kobles til sentralitetsklasse i ${y}.`)
    }

    const ds = await spor(tabell, {
      query: [
        { code: dimRegion.code, selection: { filter: 'item', values: kommuneKoder } },
        { code: dimKjonn.code, selection: { filter: 'item', values: kjonnKoder } },
        { code: dimAlder.code, selection: { filter: 'item', values: alderKoder.map((a) => a.kode) } },
        ...(innholdKode ? [{ code: 'ContentsCode', selection: { filter: 'item', values: [innholdKode] } }] : []),
        { code: dimTid.code, selection: { filter: 'item', values: [y] } },
      ],
      response: { format: 'json-stat2' },
    })

    const summer = new Map<string, number>()
    for (const rad of flatUt(ds)) {
      const klasse = klassePerKommune.get(rad[dimRegion.code])
      const alder = kodeTilAlder.get(rad[dimAlder.code])
      if (!klasse || alder === undefined) continue
      const mapKey = `__sentralitet${klasse}|${bandFor(alder)}`
      summer.set(mapKey, (summer.get(mapKey) ?? 0) + (Number(rad.verdi) || 0))
    }

    for (let klasse = 1; klasse <= 6; klasse += 1) {
      const ref = `__sentralitet${klasse}`
      for (const band of ALDERSBAND) {
        sammenligninger.push([ref, Number(y), band.key, summer.get(`${ref}|${band.key}`) ?? 0])
      }
    }
  }

  const manglendeAr = onskedeAr.filter((y) => !finnesTid.has(y))
  return {
    kilde: `ssb:${tabell} · klass:128`,
    aldersbaand: ALDERSBAND.map((band) => band.key),
    sammenligninger,
    advarsler: manglendeAr.length ? [`Tabell ${tabell} har ikke årene ${manglendeAr.join(', ')}.`] : [],
  }
}
