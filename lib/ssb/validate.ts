/**
 * Kontraktsvalidering av et ferdig SSB-datasett.
 *
 * Dette er sikringen mot den farligste feilen ved direkteoppslag: at SSB
 * svarer 200 OK med tall som betyr noe annet enn før. En omkodet kommune, en
 * endret enhet eller en tabell som har mistet et år gir ingen HTTP-feil — den
 * gir en graf som ser helt normal ut og er gal.
 *
 * Derfor slipper ingenting gjennom uten å ha bestått både formkontroll
 * (er radene som avtalt?) og rimelighetskontroll (er tallene i nærheten av
 * det de var?). Feiler noe, beholder vi forrige gyldige uttrekk.
 *
 * Reglene under er delt i to grupper:
 *  - Generiske regler (form, dekning, andel-grenser) gjelder ALLE temaer og
 *    alle indikatorer, uten å hardkode indikatornavn — en ny indikator i et
 *    nytt tema arver dem gratis.
 *  - Befolkningsspesifikke regler (§4–§6) ser bare på indikatoren
 *    «folkemengde» og er derfor no-op for temaer som ikke har den. De er
 *    strengere enn de generiske reglene fordi vi vet konkret hvor store
 *    endringer et folketall kan gjøre — det vet vi ikke generelt for en
 *    vilkårlig fremtidig indikator.
 */
import { ANTALL_KOMMUNER, REGIONNAVN } from './regioner'
import type { Datasett, Faktarad } from './types'
import { KONTRAKT_VERSJON } from './types'

/**
 * Fjerner HELE indikatorer som ikke dekker alle 18 kommuner i hvert av
 * årene de selv har data for — IKKE alle år datasettet totalt sett dekker.
 *
 * Forskjellen er med vilje: en indikator fra en annen tabell enn
 * hovedindikatoren (f.eks. lånegjeld fra en annen KOSTRA-tabell enn
 * driftsresultat) kan ha en KORTERE publiseringshistorikk — SSB henger ofte
 * etter på ferskeste år for enkelte tabeller. At tabellen ennå ikke har
 * 2026 er ikke en feil; det er bare ikke publisert ennå, og skal ikke
 * kaste ut hele indikatoren for de ti forutgående årene den faktisk dekker.
 *
 * Det denne fortsatt fanger opp: en indikator som har NOEN rader for et år,
 * men ikke for alle 18 kommuner det året — det er et reelt tegn på en
 * kommunekode som ikke matcher, ikke en publiseringsforsinkelse.
 */
export function fjernIndikatorerUtenFullDekning(
  fakta: Faktarad[]
): { fakta: Faktarad[]; droppet: string[] } {
  const antallKommuner = Object.keys(REGIONNAVN).length
  const dekning = new Map<string, Map<number, Set<string>>>() // indikator → år → sett av regioner
  for (const [region, ar, ind] of fakta) {
    if (!dekning.has(ind)) dekning.set(ind, new Map())
    const perAr = dekning.get(ind)!
    if (!perAr.has(ar)) perAr.set(ar, new Set())
    perAr.get(ar)!.add(region)
  }
  const droppet = [...dekning.entries()]
    .filter(([, perAr]) => [...perAr.values()].some((regioner) => regioner.size < antallKommuner))
    .map(([ind]) => ind)
  const droppetSett = new Set(droppet)
  return {
    fakta: fakta.filter(([, , ind]) => !droppetSett.has(ind)),
    droppet,
  }
}

/** Folketallet i Finnmark har ligget rundt 73 000 i hele perioden vi henter. */
const FINNMARK_MIN = 50_000
const FINNMARK_MAKS = 120_000

/** Ingen finnmarkskommune har flyttet mer enn noen få prosent på ett år. */
const MAKS_ENDRING_ETT_AR = 0.25

/** Et helt uttrekk skal ikke hoppe mot forrige gang. */
const MAKS_ENDRING_MOT_FORRIGE = 0.1

const VALGTYPER = new Set(['kommune', 'storting', 'fylkesting'])
/** Mandater fordeles på fylkesnivå — kommunestyrevalg har ingen mandatrader. */
const MANDAT_VALGTYPER = new Set(['storting', 'fylkesting'])

export interface Validering {
  ok: boolean
  feil: string[]
  advarsler: string[]
}

const erHeltall = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const erAndelsindikator = (ind: string) => ind.startsWith('andel')

/**
 * @param ny      datasettet som nettopp ble hentet
 * @param forrige siste kjente gyldige datasett, hvis vi har et
 */
export function valider(ny: Datasett, forrige?: Datasett | null): Validering {
  const feil: string[] = []
  const advarsler: string[] = []
  const meld = (b: boolean, m: string) => { if (!b) feil.push(m) }

  /* ── 1. Form ───────────────────────────────────────────────────────────── */
  meld(ny.kontrakt === KONTRAKT_VERSJON, `Kontraktversjon ${ny.kontrakt}, forventet ${KONTRAKT_VERSJON}.`)
  meld(Array.isArray(ny.aar) && ny.aar.length > 0, 'Datasettet har ingen år.')
  const harData = (ny.fakta?.length ?? 0) > 0 || (ny.befolkning?.length ?? 0) > 0 || (ny.resultater?.length ?? 0) > 0
  meld(harData, 'Datasettet har verken faktarader, strukturrader eller valgresultater.')
  if (feil.length) return { ok: false, feil, advarsler }

  for (const [i, rad] of (ny.fakta ?? []).entries()) {
    if (!Array.isArray(rad) || rad.length !== 4) { feil.push(`Faktarad ${i} har feil form.`); break }
    const [region, ar, ind, verdi] = rad
    if (!REGIONNAVN[region]) { feil.push(`Faktarad ${i} har ukjent region «${region}».`); break }
    if (!erHeltall(ar) || !erHeltall(verdi) || typeof ind !== 'string') {
      feil.push(`Faktarad ${i} (${region} ${ar} ${ind}) har ugyldige verdier.`); break
    }
  }

  for (const [i, rad] of (ny.befolkning ?? []).entries()) {
    if (!Array.isArray(rad) || rad.length !== 5) { feil.push(`Strukturrad ${i} har feil form.`); break }
    const [region, , kjonn, , antall] = rad
    if (!REGIONNAVN[region]) { feil.push(`Strukturrad ${i} har ukjent region «${region}».`); break }
    if (kjonn !== 'm' && kjonn !== 'k') { feil.push(`Strukturrad ${i} har ugyldig kjønn «${kjonn}».`); break }
    if (!erHeltall(antall) || antall < 0) { feil.push(`Strukturrad ${i} har ugyldig antall ${antall}.`); break }
  }

  for (const [i, rad] of (ny.resultater ?? []).entries()) {
    if (!Array.isArray(rad) || rad.length !== 5) { feil.push(`Valgrad ${i} har feil form.`); break }
    const [valgtype, region, ar, parti, andel] = rad
    if (!VALGTYPER.has(valgtype)) { feil.push(`Valgrad ${i} har ukjent valgtype «${valgtype}».`); break }
    if (!REGIONNAVN[region]) { feil.push(`Valgrad ${i} har ukjent region «${region}».`); break }
    if (!erHeltall(ar) || typeof parti !== 'string' || !erHeltall(andel)) {
      feil.push(`Valgrad ${i} (${valgtype} ${region} ${ar} ${parti}) har ugyldige verdier.`); break
    }
    if (andel < 0 || andel > 100) { feil.push(`Valgrad ${i}: ${parti} fikk ${andel} %, som er umulig.`); break }
  }

  // Mandater er fylkesnivå, ikke per kommune, og partikode/-navn kommer
  // direkte fra kilden i stedet for panelets faste åtte — derfor ingen
  // REGIONNAVN- eller kjent-parti-sjekk her, bare grunnleggende form.
  for (const [i, rad] of (ny.mandater ?? []).entries()) {
    if (!Array.isArray(rad) || rad.length !== 5) { feil.push(`Mandatrad ${i} har feil form.`); break }
    const [valgtype, ar, partikode, partinavn, mandaterAntall] = rad
    if (!MANDAT_VALGTYPER.has(valgtype)) { feil.push(`Mandatrad ${i} har ukjent valgtype «${valgtype}».`); break }
    if (!erHeltall(ar) || typeof partikode !== 'string' || typeof partinavn !== 'string' || !erHeltall(mandaterAntall)) {
      feil.push(`Mandatrad ${i} (${valgtype} ${ar} ${partikode}) har ugyldige verdier.`); break
    }
    if (mandaterAntall < 0) { feil.push(`Mandatrad ${i}: ${partikode} fikk ${mandaterAntall} mandater, som er umulig.`); break }
  }
  if (feil.length) return { ok: false, feil, advarsler }

  /* ── 2. Dekning og andelsgrenser — generisk per indikator ────────────────── */
  const perRegionArInd = new Map<string, number>() // `${region}|${ar}|${ind}` → verdi
  const indikatorer = new Set<string>()
  const folkemengde = new Map<string, number>() // `${region}|${ar}` → verdi, til §4–§6

  for (const [region, ar, ind, verdi] of ny.fakta ?? []) {
    perRegionArInd.set(`${region}|${ar}|${ind}`, verdi)
    indikatorer.add(ind)
    if (ind === 'folkemengde') folkemengde.set(`${region}|${ar}`, verdi)
    if (erAndelsindikator(ind) && (verdi < 0 || verdi > 100)) {
      feil.push(`${region} ${ar}: ${ind} er ${verdi} %, som er umulig.`)
    }
  }

  // Hver indikator som finnes i det hele tatt, må finnes for ALLE kommuner i
  // hvert av årene DEN SELV har data for — ikke nødvendigvis alle år
  // datasettet totalt sett dekker. En sekundær indikator fra en annen tabell
  // enn hovedindikatoren kan ha en kortere publiseringshistorikk (SSB henger
  // ofte etter på ferskeste år for enkelte tabeller); det er ikke en feil,
  // bare ikke publisert ennå. Det som fortsatt fanges opp: en indikator som
  // har NOEN rader for et år, men ikke for alle 18 kommuner det året — det
  // er et reelt tegn på en kommunekode som ikke matcher.
  const arPerIndikator = new Map<string, Set<number>>()
  for (const [, ar, ind] of ny.fakta ?? []) {
    if (!arPerIndikator.has(ind)) arPerIndikator.set(ind, new Set())
    arPerIndikator.get(ind)!.add(ar)
  }
  for (const ind of indikatorer) {
    for (const ar of arPerIndikator.get(ind) ?? []) {
      const mangler = Object.keys(REGIONNAVN).filter((k) => !perRegionArInd.has(`${k}|${ar}|${ind}`))
      if (mangler.length) {
        feil.push(`${ar}: mangler ${ind} for ${mangler.length} av ${ANTALL_KOMMUNER} kommuner (${mangler.join(', ')}).`)
      }
    }
  }

  /* ── 3. Struktur mot totalsum (befolkning) ────────────────────────────── */
  if (ny.befolkning?.length) {
    const struktur = new Map<string, number>()
    for (const [region, ar, , , antall] of ny.befolkning) {
      struktur.set(`${region}|${ar}`, (struktur.get(`${region}|${ar}`) ?? 0) + antall)
    }
    for (const [nokkel, sum] of struktur) {
      const total = folkemengde.get(nokkel)
      if (total !== undefined && sum !== total) {
        feil.push(`${nokkel}: aldersstrukturen summerer til ${sum}, folkemengden er ${total}.`)
      }
    }
  }

  /* ── 3b. Valgandeler kan aldri overstige 100 % samlet ────────────────────
     Våre åtte partier er et UTVALG, ikke alle som stilte — «andre lister»
     er bevisst utelatt. Summen deres skal derfor være ≤ 100, aldri mer. En
     sum over 100 betyr nesten alltid at tallene er brøk (0,34) og ikke
     prosent (34) et sted i kjeden. */
  if (ny.resultater?.length) {
    const sum = new Map<string, number>()
    for (const [valgtype, region, ar, , andel] of ny.resultater) {
      const nokkel = `${valgtype}|${region}|${ar}`
      sum.set(nokkel, (sum.get(nokkel) ?? 0) + andel)
    }
    for (const [nokkel, total] of sum) {
      if (total > 100.5) {
        feil.push(`${nokkel}: partiandelene summerer til ${total.toFixed(1)} %, som er over 100.`)
      }
    }
  }

  /* ── 4. Størrelsesorden (folkemengde) ────────────────────────────────────── */
  const finnmarkPerAr = new Map<number, number>()
  for (const [nokkel, verdi] of folkemengde) {
    const ar = Number(nokkel.split('|')[1])
    finnmarkPerAr.set(ar, (finnmarkPerAr.get(ar) ?? 0) + verdi)
  }
  for (const [ar, total] of finnmarkPerAr) {
    if (total < FINNMARK_MIN || total > FINNMARK_MAKS) {
      feil.push(
        `${ar}: Finnmark samlet blir ${total.toLocaleString('nb-NO')} innbyggere, ` +
          `utenfor det rimelige intervallet ${FINNMARK_MIN.toLocaleString('nb-NO')}–${FINNMARK_MAKS.toLocaleString('nb-NO')}. ` +
          `Enten er kommuneutvalget feil, eller så betyr tallene noe annet enn før.`
      )
    }
  }

  /* ── 5. Sprang mellom år (folkemengde) ───────────────────────────────────── */
  const sortert = [...ny.aar].sort((a, b) => a - b)
  for (const region of Object.keys(REGIONNAVN)) {
    for (let i = 1; i < sortert.length; i++) {
      const forrigeAr = folkemengde.get(`${region}|${sortert[i - 1]}`)
      const detteAr = folkemengde.get(`${region}|${sortert[i]}`)
      if (!forrigeAr || detteAr === undefined) continue
      const endring = Math.abs(detteAr - forrigeAr) / forrigeAr
      if (endring > MAKS_ENDRING_ETT_AR) {
        feil.push(
          `${REGIONNAVN[region]}: folketallet endret seg ${Math.round(endring * 100)} % fra ` +
            `${sortert[i - 1]} (${forrigeAr}) til ${sortert[i]} (${detteAr}). ` +
            `Så store hopp skyldes normalt at kommunekoden peker feil, ikke flytting.`
        )
      }
    }
  }

  /* ── 6. Mot forrige uttrekk (folkemengde) ────────────────────────────────── */
  if (forrige?.fakta?.length) {
    const forrigeTotal = new Map<string, number>()
    for (const [region, ar, ind, verdi] of forrige.fakta) {
      if (ind === 'folkemengde') forrigeTotal.set(`${region}|${ar}`, verdi)
    }
    let storsteAvvik = 0
    let verstingen = ''
    for (const [nokkel, verdi] of folkemengde) {
      const for_ = forrigeTotal.get(nokkel)
      if (!for_) continue
      const avvik = Math.abs(verdi - for_) / for_
      if (avvik > storsteAvvik) { storsteAvvik = avvik; verstingen = `${nokkel}: ${for_} → ${verdi}` }
    }
    if (storsteAvvik > MAKS_ENDRING_MOT_FORRIGE) {
      feil.push(
        `Tall som allerede var hentet har endret seg med ${Math.round(storsteAvvik * 100)} % ` +
          `siden forrige uttrekk (${verstingen}). Historiske år skal ikke bevege seg.`
      )
    }

    const tapteAr = forrige.aar.filter((a) => !ny.aar.includes(a))
    if (tapteAr.length) {
      feil.push(`Uttrekket mangler årene ${tapteAr.join(', ')}, som forrige uttrekk hadde.`)
    }
  }

  /* Advarsler fra selve hentingen følger med, men blokkerer ikke. */
  advarsler.push(...(ny.advarsler ?? []))

  return { ok: feil.length === 0, feil, advarsler }
}
