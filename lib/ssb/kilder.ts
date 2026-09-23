/**
 * Kilderegisteret: én oppføring per underliggende SSB-tabell/ekstern kilde,
 * ikke per tema. Dette er grunnlaget for inkrementell henting — "Hent alle
 * nå" skal bare røre kilder som mangler eller er eksplisitt flagget, ikke
 * hente hele temaet på nytt hver gang.
 *
 * En kildes hent-funksjon kan lese en ANNEN kildes hurtigbufrede payload via
 * ctx.lesKilde — en billig databaselesning, ikke et nytt nettverkskall — for
 * de to tilfellene der én tabell reelt trenger en annen tabells tall (se
 * naering.ts sin andel_kommunal og okonomi.ts sin nøkkeltall-kilde).
 *
 * settSammenDatasett() slår sammen alle kilders bidrag for ett tema til det
 * Datasett-formatet /api/ssb/[tema] og validate.ts sin valider() allerede
 * kjenner — verken den offentlige leseveien eller valideringen trenger å
 * vite at dataene kom fra flere separate hentinger.
 */
import { hentKildeStruktur, hentKildeEndringer, hentKildeSammenligninger } from './befolkning'
import {
  hentKildeSysselsatte,
  hentKildeKommunalSektor,
  hentKildeForetak,
  hentKildeSysselsettingsandel,
} from './naering'
import { hentKildeHoved, hentKildeDisposisjonsfond, hentKildeNokkeltall } from './okonomi'
import { hentKildeKommunestyre } from './valg'
import { hentKildeFylkestingsvalg, hentKildeStortingsvalg } from './valgresultat'
import type { Kommune } from './regioner'
import type { Datasett, Faktarad, Mandatrad, Sammenligningsrad, Strukturrad, Tema, Valgrad } from './types'
import { KONTRAKT_VERSJON } from './types'

/** Én kildes eget bidrag til et tema — det som faktisk hurtigbufres. */
export interface KildePayload {
  kilde: string
  fakta?: Faktarad[]
  befolkning?: Strukturrad[]
  sammenligninger?: Sammenligningsrad[]
  resultater?: Valgrad[]
  mandater?: Mandatrad[]
  aldersbaand?: string[]
  kodebruk?: Record<string, Record<number, string[]>>
  advarsler: string[]
}

/** Lagret rad for én kilde, slik store.ts leser/skriver den. */
export interface KildeRad {
  id: string
  tema: Tema
  navn: string
  kilde: string
  payload: KildePayload | null
  hentet: string | null
  sistForsokt: string | null
  sisteFeil: string | null
  feilSiden: string | null
  antallFeil: number
  tvungenOppdatering: boolean
}

export interface KildeContext {
  kommuner: Kommune[]
  /** Leser en ANNEN kildes hurtigbufrede payload — null hvis den aldri er hentet. */
  lesKilde: (id: string) => Promise<KildePayload | null>
}

export interface KildeDef {
  id: string
  tema: Tema
  navn: string
  kilde: string
  hent: (ctx: KildeContext) => Promise<KildePayload>
}

export const KILDE_REGISTRY: KildeDef[] = [
  { id: 'befolkning:07459', tema: 'befolkning', navn: 'Befolkning etter kjønn og alder', kilde: 'ssb:07459', hent: hentKildeStruktur },
  { id: 'befolkning:11805', tema: 'befolkning', navn: 'Norge og sentralitetsgruppe 1–6', kilde: 'ssb:07459 · klass:128', hent: hentKildeSammenligninger },
  { id: 'befolkning:01223', tema: 'befolkning', navn: 'Fødselsoverskudd og nettoflytting', kilde: 'ssb:01223', hent: hentKildeEndringer },
  { id: 'naering:11616', tema: 'naering', navn: 'Sysselsatte og arbeidsplasser', kilde: 'ssb:11616', hent: hentKildeSysselsatte },
  { id: 'naering:11917', tema: 'naering', navn: 'Andel i kommunal sektor', kilde: 'ssb:11917', hent: hentKildeKommunalSektor },
  { id: 'naering:07091', tema: 'naering', navn: 'Registrerte foretak', kilde: 'ssb:07091', hent: hentKildeForetak },
  { id: 'naering:06445', tema: 'naering', navn: 'Sysselsettingsandel', kilde: 'ssb:06445', hent: hentKildeSysselsettingsandel },
  { id: 'okonomi:12134', tema: 'okonomi', navn: 'Driftsresultat og frie inntekter', kilde: 'kostra:12134', hent: hentKildeHoved },
  { id: 'okonomi:12143', tema: 'okonomi', navn: 'Disposisjonsfond', kilde: 'kostra:12143', hent: hentKildeDisposisjonsfond },
  { id: 'okonomi:12137', tema: 'okonomi', navn: 'Netto lånegjeld per innbygger', kilde: 'kostra:12137', hent: hentKildeNokkeltall },
  { id: 'valg:01180', tema: 'valg', navn: 'Kommunestyrevalg', kilde: 'ssb:01180', hent: hentKildeKommunestyre },
  { id: 'valg:valgresultat', tema: 'valg', navn: 'Stortingsvalg', kilde: 'valgresultat.no', hent: hentKildeStortingsvalg },
  { id: 'valg:fylkesting', tema: 'valg', navn: 'Fylkestingsvalg', kilde: 'valgresultat.no', hent: hentKildeFylkestingsvalg },
]

export const finnKildeDef = (id: string): KildeDef | undefined => KILDE_REGISTRY.find((k) => k.id === id)

/**
 * Slår sammen alle kilders bidrag for ett tema til ett Datasett. Kilder som
 * aldri er hentet (payload === null) bidrar rett og slett ikke — akkurat som
 * i dag, der en indikator som ikke finnes i fakta faller tilbake til
 * demodata i panelet.
 *
 * `hentet` for HELE temaet er den ELDSTE av kildenes hentet-tidspunkt — vis
 * aldri ferskere enn den minst ferske ingrediensen.
 */
export function settSammenDatasett(tema: Tema, rader: KildeRad[]): Datasett {
  const relevante = rader.filter((r): r is KildeRad & { payload: KildePayload } => r.tema === tema && r.payload !== null)

  const fakta: Faktarad[] = []
  const befolkning: Strukturrad[] = []
  const sammenligninger: Sammenligningsrad[] = []
  const resultater: Valgrad[] = []
  const mandater: Mandatrad[] = []
  const advarsler: string[] = []
  const aldersbaand = new Set<string>()
  const kodebruk: Record<string, Record<number, string[]>> = {}
  const kilder: string[] = []
  let hentet: string | null = null

  for (const r of relevante) {
    const p = r.payload
    if (p.fakta) fakta.push(...p.fakta)
    if (p.befolkning) befolkning.push(...p.befolkning)
    if (p.sammenligninger) sammenligninger.push(...p.sammenligninger)
    if (p.resultater) resultater.push(...p.resultater)
    if (p.mandater) mandater.push(...p.mandater)
    if (p.advarsler) advarsler.push(...p.advarsler)
    if (p.aldersbaand) p.aldersbaand.forEach((b) => aldersbaand.add(b))
    if (p.kodebruk) {
      for (const [region, perAr] of Object.entries(p.kodebruk)) {
        kodebruk[region] = { ...(kodebruk[region] ?? {}), ...perAr }
      }
    }
    kilder.push(p.kilde)
    if (r.hentet && (!hentet || r.hentet < hentet)) hentet = r.hentet
  }

  const aar = [
    ...new Set([...fakta.map((f) => f[1]), ...befolkning.map((b) => b[1]), ...sammenligninger.map((s) => s[1]), ...resultater.map((v) => v[2])]),
  ].sort((a, b) => a - b)

  return {
    kontrakt: KONTRAKT_VERSJON,
    tema,
    kilde: kilder.length ? kilder.join(' + ') : '(ingen kilder hentet ennå)',
    hentet: hentet ?? new Date(0).toISOString(),
    aar,
    ...(aldersbaand.size ? { aldersbaand: [...aldersbaand] } : {}),
    fakta,
    ...(befolkning.length ? { befolkning } : {}),
    ...(sammenligninger.length ? { sammenligninger } : {}),
    ...(resultater.length ? { resultater } : {}),
    ...(mandater.length ? { mandater } : {}),
    kodebruk,
    advarsler,
  }
}
