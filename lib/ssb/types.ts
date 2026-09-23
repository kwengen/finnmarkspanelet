/**
 * Datakontrakten mellom SSB-uttrekket og Finnmarkspanelet.
 *
 * Radene er tupler, ikke objekter. Et datasett er 7 000+ rader som sendes over
 * nett ved hvert sidebesøk, og nøkkelnavn per rad ville tredoblet nyttelasten
 * uten å tilføre noe — kolonnene er dokumentert her og endres aldri uten at
 * versjonen under endres samtidig.
 */

/** Økes bare ved brytende endringer i radformatet. Klienten sjekker den. */
export const KONTRAKT_VERSJON = 1

export type Tema = 'befolkning' | 'naering' | 'okonomi' | 'valg'

/** [region, år, indikator, verdi] — indikator må finnes i panelets IND-register. */
export type Faktarad = [string, number, string, number]

/** [region, år, kjønn, aldersbånd, antall] */
export type Strukturrad = [string, number, 'm' | 'k', string, number]

/** [referanse, år, aldersbånd, antall] — Norge eller nasjonal sentralitetsgruppe. */
export type Sammenligningsrad = [string, number, string, number]

/** [valgtype ("kommune" | "storting" | "fylkesting"), region, år, parti, andel i prosent] */
export type Valgrad = [string, string, number, string, number]

/**
 * [valgtype ("storting" | "fylkesting"), år, partikode, partinavn, mandater]
 * — FYLKESNIVÅ, ikke per kommune (mandater fordeles på hele valgdistriktet/
 * fylket, ikke per kommune). Partikode/-navn kommer direkte fra kilden, ikke
 * fra panelets faste åtte-partiregister — mandatfordelingen skal vise ALLE
 * partier som faktisk fikk seter, også regionale lister utenfor de åtte.
 */
export type Mandatrad = [string, number, string, string, number]

export interface Datasett {
  kontrakt: number
  tema: Tema
  /** Tabellreferanse slik panelet viser den, f.eks. «ssb:07459». */
  kilde: string
  /** ISO-tidspunkt for når tallene ble hentet fra SSB. */
  hentet: string
  aar: number[]
  aldersbaand?: string[]
  fakta: Faktarad[]
  befolkning?: Strukturrad[]
  sammenligninger?: Sammenligningsrad[]
  resultater?: Valgrad[]
  mandater?: Mandatrad[]
  /** region → år → kommunekodene tallene faktisk ble hentet under. */
  kodebruk: Record<string, Record<number, string[]>>
  /** Ting som gikk bra nok til å fortsette, men som noen bør se på. */
  advarsler: string[]
}

/**
 * Hvor tallene kom fra denne gangen. Panelet viser dette til brukeren —
 * foreldede tall skal aldri se ut som ferske.
 */
export type Datastatus =
  /** Hentet fra SSB nå. */
  | 'fersk'
  /** Servert fra lageret, fortsatt innenfor holdbarheten. */
  | 'lagret'
  /** SSB svarte ikke eller svarte feil; dette er siste gyldige uttrekk. */
  | 'foreldet'

export interface Datasvar {
  status: Datastatus
  datasett: Datasett
  /** Satt når status er «foreldet»: hva som gikk galt ved siste forsøk. */
  feil?: string
  /** Når siste hentforsøk ble gjort, uansett utfall. */
  sistForsokt?: string
}
