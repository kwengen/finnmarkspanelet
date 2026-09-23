import { NextResponse, type NextRequest } from 'next/server'
import { erTema, lesDatasett, TEMAER } from '@/lib/ssb'

/**
 * GET /api/ssb/:tema
 *
 * Offentlig endepunkt. Serverer tall fra SSBs åpne API til Finnmarkspanelet.
 *
 * Ren lesevei — leser bare lageret, henter ALDRI fra SSB selv. Det er
 * GET /api/ssb/refresh sin jobb, utløst manuelt når noen bestemmer at det
 * trengs, ikke av at noen åpner siden. Slik unngår vi at et vanlig
 * sidebesøk kan sette i gang et SSB-kall, og at hundre samtidige besøk kan
 * sette i gang hundre.
 *
 * Hvorfor gjennom oss og ikke rett fra nettleseren:
 *
 *  - CORS. SSB bestemmer om nettleseren får lov; det gjør ikke vi.
 *  - Validering. Rådata fra SSB når aldri en leser uten å ha bestått
 *    kontrollene i lib/ssb/validate.ts (det skjer ved henting, ikke her).
 *  - Oppetid. Er SSB nede eller borte, serverer vi siste gyldige uttrekk
 *    uansett — denne ruten spør ikke SSB om noe i det hele tatt.
 *
 * Svaret bærer alltid `status`, slik at siden kan si hvor tallene kom fra.
 */

// Route-handleren snakker med Supabase og skal ikke prerendres.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tema: string }> }) {
  const { tema } = await params

  if (!erTema(tema)) {
    return NextResponse.json(
      { feil: `Ukjent tema «${tema}». Tilgjengelig: ${TEMAER.join(', ')}.` },
      { status: 404 }
    )
  }

  const svar = await lesDatasett(tema)

  if (!svar) {
    return NextResponse.json(
      {
        feil: `Ingen data hentet for temaet «${tema}» ennå.`,
        tiltak: 'Kjør GET /api/ssb/refresh (med CRON_SECRET som Bearer-token) for å hente det første gang.',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Foreldede tall (siste henteforsøk feilet) får kort cachetid, slik at en
  // etterfølgende vellykket refresh vises raskt. Gyldige, lagrede tall kan
  // ligge lenge — de endres bare når noen bevisst kjører refresh.
  const sMaxAge = svar.status === 'foreldet' ? 300 : 21_600
  const respons = NextResponse.json(svar)
  respons.headers.set('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=86400`)
  return respons
}
