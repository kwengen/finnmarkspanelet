import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Adgangskontroll for /admin og /api/admin/ssb/*.
 *
 * Panelet ble tidligere gatet av TinkrFlows' organisasjonsmodell
 * (`getOrgMemberships`). Den koblingen var hele grunnen til at
 * Finnmarkspanelet hang fast i en løsning med skrivetilgang til regnskapet,
 * og den er borte her.
 *
 * Erstatningen er bevisst så liten som oppgaven er: én delt nøkkel i
 * `FINNMARK_ADMIN_KEY`. Panelet styrer hvem som kan utløse et SSB-uttrekk og
 * flagge en kilde for tvungen oppdatering — ikke tilgang til data. Alt bak
 * porten er offentlig SSB-statistikk, og `/api/ssb/[tema]` serverer de samme
 * tallene uten autorisasjon i det hele tatt.
 *
 * Derfor: ingen Supabase Auth, ingen anon-nøkkel, ingen brukertabell, ingen
 * cookies. Nøkkelen sendes som `Authorization: Bearer`, og nettleseren husker
 * den bare i `sessionStorage` — den ligger aldri i en URL og aldri i et
 * varig lager.
 *
 * Skal panelet en dag styre noe som ikke er offentlig, er dette for lite.
 * Da er riktig svar ekte innlogging, ikke en lengre delt nøkkel.
 */

function erGyldigNokkel(request: NextRequest, nokkel: string): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  const oppgitt = Buffer.from(authorization.slice('Bearer '.length))
  const forventet = Buffer.from(nokkel)
  return oppgitt.length === forventet.length && timingSafeEqual(oppgitt, forventet)
}

/**
 * Returnerer et feilsvar hvis forespørselen ikke er autorisert, ellers `null`.
 *
 * Mangler `FINNMARK_ADMIN_KEY` svarer den `503` og slipper ingen gjennom.
 * Porten står med andre ord lukket ved feilkonfigurasjon, ikke åpen.
 */
export function avvisUautorisertAdmin(request: NextRequest): NextResponse | null {
  const nokkel = process.env.FINNMARK_ADMIN_KEY?.trim()
  if (!nokkel) {
    console.error('Adminkall avvist: FINNMARK_ADMIN_KEY mangler')
    return NextResponse.json({ feil: 'FINNMARK_ADMIN_KEY er ikke konfigurert' }, { status: 503 })
  }
  if (!erGyldigNokkel(request, nokkel)) {
    return NextResponse.json({ feil: 'Ikke autorisert' }, { status: 401 })
  }
  return null
}
