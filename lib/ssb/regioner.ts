/**
 * Kommuneregisteret for Finnmark — navn inn, koder ut.
 *
 * Her står det bevisst INGEN kommunenumre. Numrene endret seg to ganger på
 * fem år, og en hardkodet liste som er litt feil gir tall for feil kommune
 * uten at noe ser galt ut. Kodene hentes derfor fra SSBs klassifikasjons-API
 * ved hver oppdatering, og koples til de interne nøklene på navn.
 *
 *   ≤ 2019     Finnmark (20)             kommuner 20xx
 *   2020–2023  Troms og Finnmark (54)    kommuner 54xx — sammen med Troms
 *   2024–      Finnmark (56)             kommuner 56xx
 *
 * I mellomperioden deler Troms prefiksen, så settet kan ikke plukkes på kode.
 * Vi går i stedet bakover fra 2024-settet gjennom KLASS sine endringslister.
 */
import { KLASS_BASE, SsbFeil, hentJson } from './px'

/** Klassifikasjon 131: Standard for kommuneinndeling. */
const KLASSIFIKASJON = '131'
const FINNMARK_2024 = '56'

/**
 * Intern nøkkel per kommune, med navneformene KLASS kan tenkes å bruke.
 * Samiske og kvenske parallellnavn står med, fordi SSB skriver flere av
 * kommunene som «Kárášjohka - Karasjok». Alias sammenlignes normalisert.
 */
const REGISTER: Array<{ key: string; navn: string; alias: string[] }> = [
  { key: 'hammerfest',  navn: 'Hammerfest',   alias: ['hammerfest', 'hammarfeasta', 'hammerfest - hammarfeasta'] },
  { key: 'alta',        navn: 'Alta',         alias: ['alta', 'alaheadju', 'alattio'] },
  { key: 'sorvaranger', navn: 'Sør-Varanger', alias: ['sor-varanger', 'matta-varjjat'] },
  { key: 'vadso',       navn: 'Vadsø',        alias: ['vadso', 'cahcesuolu'] },
  { key: 'karasjok',    navn: 'Karasjok',     alias: ['karasjok', 'karasjohka'] },
  { key: 'kautokeino',  navn: 'Kautokeino',   alias: ['kautokeino', 'guovdageaidnu'] },
  { key: 'loppa',       navn: 'Loppa',        alias: ['loppa', 'lahppi'] },
  { key: 'hasvik',      navn: 'Hasvik',       alias: ['hasvik', 'aknoluokta'] },
  { key: 'masoy',       navn: 'Måsøy',        alias: ['masoy', 'muosat'] },
  { key: 'nordkapp',    navn: 'Nordkapp',     alias: ['nordkapp', 'davvenjarga'] },
  { key: 'porsanger',   navn: 'Porsanger',    alias: ['porsanger', 'porsangu', 'porsanki'] },
  { key: 'lebesby',     navn: 'Lebesby',      alias: ['lebesby', 'davvesiida'] },
  { key: 'gamvik',      navn: 'Gamvik',       alias: ['gamvik', 'gangaviika'] },
  { key: 'tana',        navn: 'Tana',         alias: ['tana', 'deatnu'] },
  { key: 'berlevag',    navn: 'Berlevåg',     alias: ['berlevag', 'bearalvahki'] },
  { key: 'batsfjord',   navn: 'Båtsfjord',    alias: ['batsfjord', 'bahcavuotna'] },
  { key: 'vardo',       navn: 'Vardø',        alias: ['vardo', 'varggat'] },
  { key: 'nesseby',     navn: 'Nesseby',      alias: ['nesseby', 'unjarga'] },
]

export const ANTALL_KOMMUNER = REGISTER.length
export const REGIONNAVN: Record<string, string> = Object.fromEntries(REGISTER.map((r) => [r.key, r.navn]))

/**
 * Normaliserer et kommunenavn for sammenligning: uten diakritikk, uten
 * særnorske tegn og uten «kommune»-hale. Én form inn, én form ut.
 */
function normaliser(navn: string): string {
  return navn
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+kommune$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Alle navneformene i ett SSB-navn: «Deatnu - Tana» blir til begge delene. */
function navneformer(navn: string): string[] {
  const deler = navn.split(/\s+-\s+/).map(normaliser).filter(Boolean)
  return [...new Set([normaliser(navn), ...deler])]
}

const ALIAS_TIL_KEY = new Map<string, string>()
for (const r of REGISTER) {
  for (const a of [...r.alias, r.navn]) ALIAS_TIL_KEY.set(normaliser(a), r.key)
}

export interface Kommune {
  key: string
  navn: string
  navnSSB: string
  kode2024: string
  koder2020: string[]
  koder2019: string[]
}

const erKommunekode = (k: string) => /^\d{4}$/.test(k)

async function kodelisteVed(dato: string): Promise<Map<string, string>> {
  const svar = (await hentJson(
    `${KLASS_BASE}/classifications/${KLASSIFIKASJON}/codesAt?date=${dato}`
  )) as { codes?: Array<{ code: string; name: string }> }

  const koder = (svar.codes ?? []).filter((c) => erKommunekode(c.code))
  if (!koder.length) {
    throw new SsbFeil(
      `KLASS-klassifikasjon ${KLASSIFIKASJON} ga ingen firesifrede koder for ${dato}. ` +
        `Er ${KLASSIFIKASJON} fortsatt «Standard for kommuneinndeling»?`
    )
  }
  return new Map(koder.map((c) => [c.code, c.name]))
}

/**
 * Matcher en fullstendig kodeliste (hele landet, ett tidspunkt) mot de 18
 * registrerte Finnmark-kommunene, ved navn.
 *
 * Bevisst UAVHENGIG per tidspunkt — kjeder IKKE koder bakover via KLASS sitt
 * /changes-endepunkt. Grunnen: Finnmark hadde ingen kommunesammenslåinger
 * eller -delinger i perioden 2019–2024, bare en fylkesdrevet omnummerering
 * (20xx → 54xx → 56xx). Et endepunkt for strukturelle endringer registrerer
 * ikke nødvendigvis en ren omnummerering, og en kjede bygget på den
 * antagelsen kan da stille og uten feilmelding gi tomme kodelister for alle
 * historiske år — nøyaktig det som skjedde her. Uavhengig navnematching
 * unngår avhengigheten helt: vi trenger ikke vite hvilket prefiks Finnmark
 * hadde på et gitt tidspunkt, bare at kommunen fortsatt het det den het.
 */
function matchAlle(kodeliste: Map<string, string>, dato: string): Map<string, string> {
  const kart = new Map<string, string>()
  for (const [kode, navn] of kodeliste) {
    for (const form of navneformer(navn)) {
      const key = ALIAS_TIL_KEY.get(form)
      if (!key) continue
      const forrige = kart.get(key)
      if (forrige && forrige !== kode) {
        throw new SsbFeil(
          `«${REGIONNAVN[key]}» matcher to forskjellige koder i KLASS-settet per ${dato}: ${forrige} og ${kode}.`
        )
      }
      kart.set(key, kode)
    }
  }
  return kart
}

function krevAlle(kart: Map<string, string>, dato: string): void {
  const mangler = REGISTER.filter((r) => !kart.has(r.key)).map((r) => r.navn)
  if (mangler.length) {
    throw new SsbFeil(
      `Fant ikke disse kommunene i KLASS sitt sett per ${dato}: ${mangler.join(', ')}. ` +
        `Enten het kommunen noe annet da (utvid alias i lib/ssb/regioner.ts), eller den ble ` +
        `opprettet/slått sammen i denne perioden, og antagelsen om at Finnmark ikke hadde ` +
        `kommunesammenslåinger 2019–2024 stemmer ikke lenger.`
    )
  }
}

/**
 * Kobler alle 18 Finnmark-kommuner til koden de hadde ved hvert av de tre
 * tidspunktene 2019, 2020 og 2024.
 *
 * Kaster hvis settet ikke går opp mot registeret over. Det er med vilje
 * strengt: et uttrekk med 17 av 18 kommuner ser helt normalt ut i en graf.
 */
export async function hentKommuner(): Promise<Kommune[]> {
  const [k2024, k2020, k2019] = await Promise.all([
    kodelisteVed('2024-01-01'),
    kodelisteVed('2020-01-01'),
    kodelisteVed('2019-01-01'),
  ])

  const kart2024 = matchAlle(k2024, '2024-01-01')
  const kart2020 = matchAlle(k2020, '2020-01-01')
  const kart2019 = matchAlle(k2019, '2019-01-01')

  krevAlle(kart2024, '2024-01-01')
  krevAlle(kart2020, '2020-01-01')
  krevAlle(kart2019, '2019-01-01')

  // Motsatt retning av krevAlle: fanger opp en 19. Finnmark-kommune i
  // 2024-settet som ikke finnes i registeret (feil registrert alias, eller
  // en kommune vi rett og slett har glemt).
  const finnmarkI2024 = [...k2024].filter(([kode]) => kode.startsWith(FINNMARK_2024))
  const utenTreff = finnmarkI2024.filter(([kode]) => ![...kart2024.values()].includes(kode))
  if (utenTreff.length) {
    throw new SsbFeil(
      `Fant ${utenTreff.length} Finnmark-kommune(r) i KLASS som ikke finnes i registeret: ` +
        `${utenTreff.map(([kode, navn]) => `${kode} «${navn}»`).join(', ')}. ` +
        `Legg dem til i lib/ssb/regioner.ts før uttrekket brukes.`
    )
  }
  if (finnmarkI2024.length !== ANTALL_KOMMUNER) {
    throw new SsbFeil(
      `KLASS har ${finnmarkI2024.length} kommuner med prefiks ${FINNMARK_2024} i 2024, ` +
        `registeret venter ${ANTALL_KOMMUNER}.`
    )
  }

  return REGISTER.map((r) => ({
    key: r.key,
    navn: r.navn,
    navnSSB: k2024.get(kart2024.get(r.key)!) ?? r.navn,
    kode2024: kart2024.get(r.key)!,
    koder2020: [kart2020.get(r.key)!],
    koder2019: [kart2019.get(r.key)!],
  }))
}

/** Kommunekodene som gjaldt et gitt år. Flere ved sammenslåing. */
export function kodeneFor(k: Kommune, ar: number): string[] {
  if (ar >= 2024) return [k.kode2024]
  if (ar >= 2020) return k.koder2020
  return k.koder2019
}
