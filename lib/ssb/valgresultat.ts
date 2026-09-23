/**
 * Stortingsvalg og fylkestingsvalg per kommune, fra Valgdirektoratets
 * valgresultat.no — samt mandatfordeling på fylkesnivå for begge.
 *
 * SSBs egen statistikkbank har IKKE stortingsvalg-tall på kommunenivå — bare
 * valgdistrikt (se kommentaren øverst i valg.ts for den fulle
 * undersøkelseshistorien: 08092 og 11691 ble begge prøvd og forkastet), og
 * har ikke fylkestingsvalg i det hele tatt. Valgdirektoratets API dekker
 * begge hullene med samme responsskjema.
 *
 * Bekreftet ved manuell utforsking i nettleseren (dette miljøet når ikke
 * valgresultat.no selv — brukeren hentet URL-ene og limte inn svaret):
 *  - /api/2021/st/20        → Finnmark valgdistrikt, med `_links.related`
 *    som lister kommunene under (nr 5403 Alta, 5404 Vardø, ... — SAMME
 *    kommunenumre som kodeneFor() gir for 2020–2023-perioden), OG
 *    `partier[].mandater.resultat.antall` PER PARTI direkte på fylkenivå.
 *  - /api/2021/st/20/5403   → Alta, samme responsskjema som fylkesnivået,
 *    med `partier[].id.partikode` og `partier[].stemmer.resultat.prosent`
 *    som en FERDIG prosentandel — ingen behov for å summere selv, i
 *    motsetning til SSB-tabell 01180.
 *  - Finnmark beholdt valgdistrikt-nummer 20 gjennom hele Troms og
 *    Finnmark-sammenslåingen (2020–2023): stortingsvalgets
 *    valgdistriktinndeling er UAVHENGIG av kommune-/fylkesreformen. Antas
 *    derfor stabilt for alle valgår.
 *  - Fylkestingsvalg («fy») bruker DERIMOT IKKE et fast nummer — det følger
 *    den faktiske administrative fylkesinndelingen DET året:
 *    /api/2023/fy lister Finnmark som fylkenr «56» (dagens inndeling), mens
 *    2019 sitt fylkesting var for det allerede sammenslåtte «Troms og
 *    Finnmark» (sammenslåingen tok effekt 1.1.2020, så fylkestinget valgt i
 *    sept. 2019 var for den sammenslåtte enheten — IKKE et rent
 *    Finnmark-resultat). Løst ved å slå opp fylkenummeret DYNAMISK per år
 *    via rot-listen (/api/{år}/fy), i stedet for å hardkode ett tall slik
 *    stortingsvalg trygt kan.
 *
 * Kommunenumrene i denne APIen følger PERIODENS EGEN kode (motsatt av SSBs
 * 01180, som bruker 2024-koder for alle år) — kodeneFor(k, år) er derfor
 * riktig verktøy her, kode2024 ville vært feil.
 *
 * Egen, enkel HTTP-klient i denne fila i stedet for å gjenbruke px.ts sin
 * kall() — det er en annen vert med annen feilvokabular (px.ts sine
 * feilmeldinger sier eksplisitt «SSB»), og SSBs 900ms-throttling mellom kall
 * har ingen mening å dele med et helt annet API.
 */
import { SsbFeil } from './px'
import { kodeneFor, type Kommune } from './regioner'
import type { Mandatrad, Valgrad } from './types'
import type { KildeContext, KildePayload } from './kilder'

const BASE = 'https://valgresultat.no/api'
const VALGDISTRIKT_FINNMARK_STORTING = '20'
const TIDSAVBRUDD_MS = 20_000
const MAKS_FORSOK = 3
const PAUSE_MS = 150

const sov = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function hentJson(url: string): Promise<unknown> {
  let sisteFeil: SsbFeil | null = null
  for (let forsok = 1; forsok <= MAKS_FORSOK; forsok++) {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIDSAVBRUDD_MS),
        cache: 'no-store',
      })
    } catch (e) {
      sisteFeil = new SsbFeil(`Nådde ikke valgresultat.no (${url}): ${e instanceof Error ? e.message : String(e)}`)
      if (forsok < MAKS_FORSOK) { await sov(1000 * 2 ** (forsok - 1)); continue }
      throw sisteFeil
    }
    const tekst = await res.text()
    if (!res.ok) {
      const feil = new SsbFeil(`GET ${url}: HTTP ${res.status}. ${tekst.slice(0, 300)}`, res.status)
      const kanGjentas = res.status === 429 || res.status >= 500
      if (!kanGjentas || forsok === MAKS_FORSOK) throw feil
      sisteFeil = feil
      await sov(1000 * 2 ** (forsok - 1))
      continue
    }
    try {
      return JSON.parse(tekst)
    } catch {
      throw new SsbFeil(`Svaret fra ${url} var ikke gyldig JSON: ${tekst.slice(0, 200)}`)
    }
  }
  throw sisteFeil ?? new SsbFeil(`Kallet til ${url} feilet uten årsak`)
}

/** valgresultat.nos partikoder → panelets interne partinøkler. Deres RØDT blir vår r. */
const PARTIKODE_TIL_PARTI: Record<string, string> = {
  A: 'ap', H: 'h', FRP: 'frp', SP: 'sp', SV: 'sv', V: 'v', KRF: 'krf', RØDT: 'r',
}

interface PartiSvar {
  id: { partikode: string; navn: string }
  stemmer?: { resultat?: { prosent?: number } }
  mandater?: { resultat?: { antall?: number } }
}
interface FylkeEllerLandSvar {
  partier?: PartiSvar[]
  _links?: { related?: Array<{ nr: string; navn: string }> }
}

interface PartiResultat {
  partikode: string
  navn: string
  prosent: number
  mandater: number
}

/** Trekker ut partiresultater fra én respons — samme skjema for land/fylke/kommune-nivå. */
function partierFraSvar(svar: FylkeEllerLandSvar): PartiResultat[] {
  return (svar.partier ?? []).map((p) => ({
    partikode: p.id.partikode,
    navn: p.id.navn,
    prosent: p.stemmer?.resultat?.prosent ?? 0,
    mandater: p.mandater?.resultat?.antall ?? 0,
  }))
}

/** Valgår innenfor [fra, til], hvert 4. år, forankret i `anker`. */
function valgAr(anker: number, fra: number, til: number): number[] {
  const ar: number[] = []
  for (let y = anker; y <= til; y += 4) if (y >= fra) ar.push(y)
  for (let y = anker - 4; y >= fra; y -= 4) ar.push(y)
  return [...new Set(ar)].sort((a, b) => a - b)
}

/**
 * Slår opp Finnmarks fylkenummer for et gitt år og valgtype, via rot-listen
 * for det året (/api/{år}/{kode}) — IKKE hardkodet, siden fylkestingsvalg
 * beviselig bruker forskjellige numre i forskjellige år (se kommentar
 * øverst). Matcher på navn som inneholder «finnmark» — fanger opp både
 * «Finnmark Finnmárku» og «Troms og Finnmark».
 */
async function finnFinnmarkIRotliste(
  valgtypeKode: 'st' | 'fy',
  ar: number
): Promise<{ nr: string; navn: string } | null> {
  const rot = (await hentJson(`${BASE}/${ar}/${valgtypeKode}`)) as FylkeEllerLandSvar
  const treff = (rot._links?.related ?? []).find((r) => /finnmark/i.test(r.navn))
  return treff ? { nr: treff.nr, navn: treff.navn } : null
}

/**
 * Henter ett valgår for én valgtype (stortingsvalg eller fylkestingsvalg) —
 * mandater på fylkesnivå (ALLE partier med mandater, ikke bare de åtte vi
 * sporer ellers) og stemmeandel per kommune (bare de åtte kjente partiene,
 * samme mønster som før).
 */
async function hentEttArValg(
  valgtypeKode: 'st' | 'fy',
  valgtypeIntern: string,
  ar: number,
  fastFylkenummer: string | null,
  kommuner: Kommune[]
): Promise<{ resultater: Valgrad[]; mandater: Mandatrad[]; advarsler: string[] }> {
  const advarsler: string[] = []

  let fylkenummer = fastFylkenummer
  if (!fylkenummer) {
    let treff: { nr: string; navn: string } | null
    try {
      treff = await finnFinnmarkIRotliste(valgtypeKode, ar)
    } catch (e) {
      return { resultater: [], mandater: [], advarsler: [`${valgtypeIntern} ${ar}: ${e instanceof Error ? e.message : String(e)}`] }
    }
    if (!treff) return { resultater: [], mandater: [], advarsler: [] }
    // Et sammenslått valgdistrikt er ikke et Finnmarkstall. Hopp over året
    // i stedet for å vise blandede eller delvise tall som om de var Finnmark.
    if (!/^finnmark/i.test(treff.navn)) return { resultater: [], mandater: [], advarsler: [] }
    fylkenummer = treff.nr
  }

  let fylke: FylkeEllerLandSvar
  try {
    fylke = (await hentJson(`${BASE}/${ar}/${valgtypeKode}/${fylkenummer}`)) as FylkeEllerLandSvar
  } catch (e) {
    return { resultater: [], mandater: [], advarsler: [`${valgtypeIntern} ${ar}: ${e instanceof Error ? e.message : String(e)}`] }
  }

  const mandater: Mandatrad[] = partierFraSvar(fylke)
    .filter((p) => p.mandater > 0)
    .map((p) => [valgtypeIntern, ar, p.partikode, p.navn, p.mandater])

  const tilgjengelige = new Set((fylke._links?.related ?? []).map((r) => r.nr))
  if (!tilgjengelige.size) return { resultater: [], mandater: [], advarsler: [] }

  const resultater: Valgrad[] = []
  let manglerKommune = false
  for (const k of kommuner) {
    const kode = kodeneFor(k, ar).find((c) => tilgjengelige.has(c))
    if (!kode) {
      manglerKommune = true
      continue
    }
    await sov(PAUSE_MS)
    try {
      const data = (await hentJson(`${BASE}/${ar}/${valgtypeKode}/${fylkenummer}/${kode}`)) as FylkeEllerLandSvar
      for (const p of partierFraSvar(data)) {
        const parti = PARTIKODE_TIL_PARTI[p.partikode]
        if (!parti) continue
        resultater.push([valgtypeIntern, k.key, ar, parti, Number(p.prosent.toFixed(1))])
      }
    } catch (e) {
      return { resultater: [], mandater: [], advarsler: [`${valgtypeIntern} ${ar}: ${e instanceof Error ? e.message : String(e)}`] }
    }
  }

  // Manglende kommunekoder betyr at kilden ikke er et komplett Finnmark-år.
  // Dropp hele året, slik at panelet aldri blander ekte og delvise tall.
  if (manglerKommune) return { resultater: [], mandater: [], advarsler: [] }
  return { resultater, mandater, advarsler }
}

async function hentAlleAr(
  valgtypeKode: 'st' | 'fy',
  valgtypeIntern: string,
  fastFylkenummer: string | null,
  arListe: number[],
  kommuner: Kommune[]
): Promise<KildePayload> {
  const resultater: Valgrad[] = []
  const mandater: Mandatrad[] = []
  const advarsler: string[] = []
  for (const y of arListe) {
    const r = await hentEttArValg(valgtypeKode, valgtypeIntern, y, fastFylkenummer, kommuner)
    resultater.push(...r.resultater)
    mandater.push(...r.mandater)
    advarsler.push(...r.advarsler)
  }
  return { kilde: 'valgresultat.no', resultater, mandater, advarsler }
}

/** Kilde valg:valgresultat — stortingsvalg per kommune, med mandater på fylkesnivå. */
export async function hentKildeStortingsvalg(ctx: KildeContext): Promise<KildePayload> {
  const til = new Date().getUTCFullYear()
  const ar = valgAr(2025, 2011, til)
  return hentAlleAr('st', 'storting', VALGDISTRIKT_FINNMARK_STORTING, ar, ctx.kommuner)
}

/**
 * Kilde valg:fylkesting — fylkestingsvalg per kommune, med mandater på
 * fylkesnivå. Samme valgår som kommunestyrevalg (holdes samtidig). Fylkenr
 * slås opp dynamisk per år (se hentEttArValg) — år Finnmark ikke finnes
 * under (uverifisert for 2011/2015) gir bare en advarsel, ikke en feil.
 */
export async function hentKildeFylkestingsvalg(ctx: KildeContext): Promise<KildePayload> {
  const til = new Date().getUTCFullYear()
  const ar = valgAr(2011, 2011, til)
  return hentAlleAr('fy', 'fylkesting', null, ar, ctx.kommuner)
}
