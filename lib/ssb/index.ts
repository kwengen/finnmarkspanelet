/**
 * SSB-laget: lesing og henting er to atskilte handlinger.
 *
 * Ingenting her henter automatisk. Befolkningstall og lignende publiseres
 * årlig — det finnes ikke noe "ferskt nok"-vindu som gjør en tidsplan
 * meningsfull, og et sideoppslag skal aldri utløse et kall til SSB. Ny
 * henting skjer bare når noen ber om det.
 *
 *   lesDatasett()          — leser lageret (ssb_datasett). Aldri noe
 *                             nettverkskall. Brukt av /api/ssb/:tema.
 *   oppdaterUsynkroniserte() — henter bare kilder som mangler, sist feilet,
 *                             eller er eksplisitt flagget for tvungen
 *                             oppdatering — IKKE hele temaet på nytt hver
 *                             gang. Brukt av adminpanelets «Hent alle nå».
 *   oppdaterDatasett()      — tvinger ALLE kilder i ett tema til å hentes på
 *                             nytt, uansett status. Brukt av /api/ssb/refresh
 *                             (manuelt, cron-hemmelighet).
 *   tvingKilde()            — tvinger ÉN kilde til å hentes på nytt.
 *
 * Kildene hentes og lagres uavhengig av hverandre (se lib/ssb/kilder.ts).
 * Et tema settes sammen fra alle sine kilders nå-gjeldende hurtigbuffer, og
 * det sammensatte resultatet går gjennom samme validering/lagring som før:
 * validerer et uttrekk ikke, forkastes det og forrige gyldige uttrekk står
 * urørt.
 */
import {
  KILDE_REGISTRY,
  finnKildeDef,
  settSammenDatasett,
  type KildeContext,
  type KildeRad,
} from './kilder'
import { hentKommuner, type Kommune } from './regioner'
import {
  lagreGyldig,
  lagreKildeSuksess,
  lesAlleKilder,
  lesKilde,
  lesLagret,
  noterFeil,
  noterKildeFeil,
  sikreKilderRader,
} from './store'
import type { Datasett, Datasvar, Tema } from './types'
import { valider } from './validate'

export const TEMAER = [...new Set(KILDE_REGISTRY.map((k) => k.tema))] as Tema[]
export const erTema = (v: string): v is Tema => (TEMAER as string[]).includes(v)

/** Rent lageroppslag. Returnerer null hvis temaet aldri er hentet. */
export async function lesDatasett(tema: Tema): Promise<Datasvar | null> {
  const lagret = await lesLagret(tema)
  if (!lagret) return null

  return {
    // Et lagret uttrekk vises som "foreldet" bare hvis siste HENTEFORSØK
    // feilet — ikke basert på alder. Et år gammelt befolkningstall som ble
    // hentet riktig er fortsatt riktig; det er ikke det samme som å ha et
    // mislykket forsøk stående.
    status: lagret.sisteFeil ? 'foreldet' : 'lagret',
    datasett: lagret.datasett,
    feil: lagret.sisteFeil ?? undefined,
    sistForsokt: lagret.sistForsokt ?? undefined,
  }
}

function trengerOppdatering(rad: KildeRad): boolean {
  return rad.hentet === null || rad.sisteFeil !== null || rad.tvungenOppdatering
}

function byggKontekst(kommuner: Kommune[]): KildeContext {
  return {
    kommuner,
    lesKilde: async (id) => (await lesKilde(id))?.payload ?? null,
  }
}

/** Henter ÉN kilde og lagrer resultatet (suksess eller feil) i ssb_kilder. */
export async function oppdaterKilde(kildeId: string, kommuner?: Kommune[]): Promise<void> {
  const def = finnKildeDef(kildeId)
  if (!def) throw new Error(`Ukjent kilde «${kildeId}».`)
  const ctx = byggKontekst(kommuner ?? (await hentKommuner()))

  try {
    const payload = await def.hent(ctx)
    await lagreKildeSuksess(def.id, def, payload)
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e)
    console.error(`[ssb:${def.id}] henting feilet:`, melding)
    await noterKildeFeil(def.id, def, melding).catch((lagringsfeil) => {
      console.error(`[ssb:${def.id}] klarte heller ikke å notere feilen:`, lagringsfeil)
    })
  }
}

/**
 * Setter sammen temaets Datasett fra kildenes nå-gjeldende hurtigbuffer,
 * validerer og lagrer. Rører ikke nettverket selv — kall oppdaterKilde()
 * for kildene som trengs FØR dette. Returnerer null hvis ingen kilde i
 * temaet noensinne er hentet (ingenting å sette sammen ennå).
 */
async function settSammenOgLagre(tema: Tema, alleKilder: KildeRad[]): Promise<Datasvar | null> {
  const harNoeData = alleKilder.some((r) => r.tema === tema && r.payload !== null)
  if (!harNoeData) return null

  const lagret = await lesLagret(tema)
  const ny: Datasett = settSammenDatasett(tema, alleKilder)
  const dom = valider(ny, lagret?.datasett)

  if (!dom.ok) {
    const melding = `Uttrekket bestod ikke valideringen:\n- ${dom.feil.join('\n- ')}`
    console.error(`[ssb:${tema}] ${melding}`)
    await noterFeil(tema, melding, Boolean(lagret)).catch((lagringsfeil) => {
      console.error(`[ssb:${tema}] klarte heller ikke å notere feilen:`, lagringsfeil)
    })
    if (lagret) {
      return { status: 'foreldet', datasett: lagret.datasett, feil: melding, sistForsokt: new Date().toISOString() }
    }
    throw new Error(melding)
  }
  if (dom.advarsler.length) {
    console.warn(`[ssb:${tema}] ${dom.advarsler.length} advarsler:`, dom.advarsler.slice(0, 10))
  }
  await lagreGyldig(tema, ny)
  return { status: 'fersk', datasett: ny }
}

/**
 * Henter alle kilder som mangler, sist feilet, eller er eksplisitt flagget
 * for tvungen oppdatering — IKKE alt, hver gang. Filtreres til ett tema hvis
 * oppgitt. Sekvensielt, av samme grunn som naering.ts: samtidig trykk mot
 * SSB fra flere kilder på likt ga 429 selv med riktig avstand mellom hvert
 * enkelt kall.
 */
export async function oppdaterUsynkroniserte(temaFilter?: Tema): Promise<{ forsokt: string[] }> {
  await sikreKilderRader(KILDE_REGISTRY)
  const kommuner = await hentKommuner()

  const forOppdatering = (await lesAlleKilder()).filter(
    (r) => (!temaFilter || r.tema === temaFilter) && trengerOppdatering(r)
  )
  for (const rad of forOppdatering) {
    await oppdaterKilde(rad.id, kommuner)
  }

  const alleKilder = await lesAlleKilder()
  for (const tema of temaFilter ? [temaFilter] : TEMAER) {
    await settSammenOgLagre(tema, alleKilder)
  }

  return { forsokt: forOppdatering.map((r) => r.id) }
}

/** Tvinger ÉN kilde til å hentes på nytt, uansett status, og setter sammen dens tema på nytt. */
export async function tvingKilde(kildeId: string): Promise<void> {
  const def = finnKildeDef(kildeId)
  if (!def) throw new Error(`Ukjent kilde «${kildeId}».`)
  await sikreKilderRader(KILDE_REGISTRY)
  const kommuner = await hentKommuner()
  await oppdaterKilde(kildeId, kommuner)
  const alleKilder = await lesAlleKilder()
  await settSammenOgLagre(def.tema, alleKilder)
}

/**
 * Tvinger ALLE kilder i ett tema til å hentes på nytt, uansett status. Brukt
 * av det offentlige, manuelt utløste cron-endepunktet (/api/ssb/refresh) for
 * å beholde et «hent alt for dette temaet»-alternativ.
 */
export async function oppdaterDatasett(tema: Tema): Promise<Datasvar> {
  await sikreKilderRader(KILDE_REGISTRY)
  const kommuner = await hentKommuner()
  for (const def of KILDE_REGISTRY.filter((k) => k.tema === tema)) {
    await oppdaterKilde(def.id, kommuner)
  }
  const alleKilder = await lesAlleKilder()
  const svar = await settSammenOgLagre(tema, alleKilder)
  if (!svar) throw new Error(`Ingen kilder i tema ${tema} ga noe resultat.`)
  return svar
}

export type { Datasett, Datasvar, Tema } from './types'
export { KILDE_REGISTRY } from './kilder'
export type { KildeRad } from './kilder'
