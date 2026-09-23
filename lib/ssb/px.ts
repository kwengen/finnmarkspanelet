/**
 * Klient mot SSBs PxWebApi og KLASS.
 *
 * Ingen autentisering — API-ene er åpne. Modulen har med vilje ingen
 * avhengigheter til Next eller Supabase. Det var den egenskapen som gjorde
 * at SSB-laget kunne flyttes hit fra TinkrFlows uten omskriving.
 */

export const PX_BASE = 'https://data.ssb.no/api/v0/no/table'
export const KLASS_BASE = 'https://data.ssb.no/api/klass/v1'

const TIDSAVBRUDD_MS = 20_000
const MAKS_FORSOK = 4

/**
 * SSB har kallgrense per IP. Vi holder god margin med en pause mellom kall.
 *
 * Flere temaer henter samtidig (Promise.all i naering.ts/okonomi.ts), så
 * dette må være trygt mot samtidige kall. `nesteLedigeTid` reserveres
 * SYNKRONT, før noe awaites — ellers kan to samtidige kall begge lese samme
 * `sisteKall`, begge bestemme seg for å vente til samme tidspunkt, og lande
 * på nøyaktig samme millisekund likevel (observert som en flom av 429 fra
 * SSB selv med denne pausen på plass, fordi selve reserveringen skjedde for
 * sent til å hindre kollisjonen).
 */
// SSB dokumenterer en grense på 30 spørringer/minutt per IP. 2,1 s gir
// litt margin også når flere jobber deler samme utgående IP.
const PAUSE_MS = 2_100
const MIN_429_PAUSE_MS = 10_000
let nesteLedigeTid = 0

const sov = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function stagger() {
  const na = Date.now()
  const tildelt = Math.max(na, nesteLedigeTid)
  nesteLedigeTid = tildelt + PAUSE_MS
  if (tildelt > na) await sov(tildelt - na)
}

export class SsbFeil extends Error {
  readonly status: number | null
  constructor(melding: string, status: number | null = null) {
    super(melding)
    this.name = 'SsbFeil'
    this.status = status
  }
}

function forklar(status: number, kropp: string): string {
  const kort = kropp.slice(0, 300)
  if (status === 403) return `HTTP 403 — uttrekket er for stort, eller et filter er ugyldig. ${kort}`
  if (status === 404) return `HTTP 404 — tabellen finnes ikke på denne adressen. ${kort}`
  if (status === 429) return `HTTP 429 — for mange kall mot SSB. ${kort}`
  return `HTTP ${status}. ${kort}`
}

/** Sekunder å vente ifølge Retry-After, hvis serveren sa noe fornuftig. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after')
  if (!h) return null
  const sek = Number(h)
  if (Number.isFinite(sek) && sek >= 0) return Math.min(sek, 30) * 1000
  const dato = Date.parse(h)
  return Number.isNaN(dato) ? null : Math.max(0, Math.min(dato - Date.now(), 30_000))
}

/**
 * Ett HTTP-kall med gjenforsøk. Bare 429 og 5xx forsøkes på nytt — 403 og 404
 * er feil i spørringen vår og blir ikke bedre av å gjentas.
 */
async function kall(url: string, init?: RequestInit): Promise<unknown> {
  let sisteFeil: SsbFeil | null = null

  for (let forsok = 1; forsok <= MAKS_FORSOK; forsok++) {
    await stagger()
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(TIDSAVBRUDD_MS),
        cache: 'no-store',
      })
    } catch (e) {
      sisteFeil = new SsbFeil(
        e instanceof Error && e.name === 'TimeoutError'
          ? `SSB svarte ikke innen ${TIDSAVBRUDD_MS / 1000} s (${url})`
          : `Nådde ikke SSB (${url}): ${e instanceof Error ? e.message : String(e)}`
      )
      if (forsok < MAKS_FORSOK) { await sov(1000 * 2 ** (forsok - 1)); continue }
      throw sisteFeil
    }

    const tekst = await res.text()

    if (!res.ok) {
      const feil = new SsbFeil(`${init?.method ?? 'GET'} ${url}: ${forklar(res.status, tekst)}`, res.status)
      const kanGjentas = res.status === 429 || res.status >= 500
      if (!kanGjentas || forsok === MAKS_FORSOK) throw feil
      sisteFeil = feil
      const ventMs = retryAfterMs(res) ?? (
        res.status === 429 ? MIN_429_PAUSE_MS * forsok : 1000 * 2 ** (forsok - 1)
      )
      // En 429 gjelder den delte IP-kvoten. Skyv også allerede kølagte kall
      // fremover, ellers kan de spise opp hele nedkjølingsperioden.
      if (res.status === 429) {
        nesteLedigeTid = Math.max(nesteLedigeTid, Date.now() + ventMs)
      }
      await sov(ventMs)
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

export const hentJson = (url: string) => kall(url)

export const spor = (tabell: string, sporring: unknown) =>
  kall(`${PX_BASE}/${tabell}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sporring),
  })

/* ── Metadata ─────────────────────────────────────────────────────────────── */

export interface Dimensjon {
  code: string
  text: string
  values: string[]
  valueTexts?: string[]
  time?: boolean
  elimination?: boolean
}
export interface TabellMeta {
  title: string
  variables: Dimensjon[]
}

export async function hentMeta(tabell: string): Promise<TabellMeta> {
  const m = (await hentJson(`${PX_BASE}/${tabell}`)) as Partial<TabellMeta>
  if (!Array.isArray(m?.variables)) {
    throw new SsbFeil(`Tabell ${tabell} ga ikke metadata med «variables».`)
  }
  return { title: m.title ?? tabell, variables: m.variables }
}

/**
 * Finner dimensjonen som matcher ett av flere mulige navn. SSB er ikke
 * konsekvent på tvers av tabeller (Region/Regioner, Kjonn/Kjønn), så vi slår
 * opp framfor å hardkode — og feiler tydelig når ingen av dem finnes.
 */
export function finnDim(meta: TabellMeta, kandidater: string[]): Dimensjon {
  for (const k of kandidater) {
    const treff = meta.variables.find(
      (v) => v.code?.toLowerCase() === k.toLowerCase() || v.text?.toLowerCase() === k.toLowerCase()
    )
    if (treff) return treff
  }
  throw new SsbFeil(
    `Fant ingen dimensjon som ligner «${kandidater[0]}». Tabellen har: ` +
      meta.variables.map((v) => `${v.code} («${v.text}»)`).join(', ')
  )
}

/* ── json-stat2 ───────────────────────────────────────────────────────────── */

interface JsonStat2 {
  id: string[]
  size: number[]
  value: Array<number | null> | Record<string, number | null>
  dimension: Record<string, { category?: { index?: string[] | Record<string, number> } }>
}

export type Rad = Record<string, string> & { verdi: number }

/**
 * Flater ut et json-stat2-datasett til rader.
 *
 * Verdiene ligger i én flat liste i rad-hovedrekkefølge — siste dimensjon
 * varierer raskest — så vi regner oss bakover gjennom dimensjonene for hver
 * indeks. Nullverdier hoppes over; SSB bruker dem for celler som ikke finnes,
 * f.eks. en kommune som ikke eksisterte det året.
 */
export function flatUt(ds: unknown): Rad[] {
  const d = ds as JsonStat2
  if (!Array.isArray(d?.id) || !Array.isArray(d?.size) || d?.value === undefined) {
    throw new SsbFeil('Svaret fra SSB er ikke json-stat2 (mangler id, size eller value).')
  }

  const dims = d.id.map((id) => {
    const idx = d.dimension?.[id]?.category?.index
    const koder = Array.isArray(idx)
      ? idx
      : Object.keys(idx ?? {}).sort((a, b) => (idx as Record<string, number>)[a] - (idx as Record<string, number>)[b])
    return { id, koder }
  })

  const antall = d.size.reduce((a, b) => a * b, 1)
  const hent = Array.isArray(d.value)
    ? (i: number) => (d.value as Array<number | null>)[i]
    : (i: number) => (d.value as Record<string, number | null>)[String(i)]

  const rader: Rad[] = []
  for (let i = 0; i < antall; i++) {
    const v = hent(i)
    if (v === null || v === undefined) continue
    let rest = i
    const rad = { verdi: v } as Rad
    for (let k = dims.length - 1; k >= 0; k--) {
      const j = rest % d.size[k]
      rest = Math.floor(rest / d.size[k])
      rad[dims[k].id] = dims[k].koder[j]
    }
    rader.push(rad)
  }
  return rader
}
