import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { erTema, lesDatasett, oppdaterUsynkroniserte, TEMAER } from '@/lib/ssb'

/**
 * GET /api/ssb/refresh[?tema=befolkning]
 *
 * Utløses FOR HÅND — det finnes ingen cron mot dette endepunktet. Kjør det
 * når et nytt tema tas i bruk første gang, eller når SSB har publisert noe
 * nytt man vil hente inn. Statistikken som hentes her endrer seg sjelden nok
 * (typisk årlig) til at en tidsplan bare ville vært et kall uten formål.
 *
 * Henter bare kilder som mangler, sist feilet, eller er eksplisitt flagget
 * for tvungen oppdatering (se /admin for den avmerkingsboksen) —
 * IKKE hele temaet på nytt hver gang. Uten ?tema vurderes alle kjente
 * temaer. Med ?tema=befolkning vurderes bare det ene.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<domene>/api/ssb/refresh?tema=befolkning
 *
 * Navnet CRON_SECRET er arvet fra TinkrFlows, der hemmeligheten var delt med
 * /api/sync/cron. Her finnes ingen cron — dette er bare en enkel sperre mot
 * at hvem som helst kan utløse et SSB/KLASS-kall. Verdien er ny og egen; den
 * skal ikke være den samme som TinkrFlows sin.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function harGyldigAutorisasjon(request: NextRequest, secret: string): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  const oppgitt = Buffer.from(authorization.slice('Bearer '.length))
  const forventet = Buffer.from(secret)
  return oppgitt.length === forventet.length && timingSafeEqual(oppgitt, forventet)
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    console.error('SSB-oppdatering avvist: CRON_SECRET mangler')
    return NextResponse.json({ feil: 'CRON_SECRET er ikke konfigurert' }, { status: 503 })
  }
  if (!harGyldigAutorisasjon(request, cronSecret)) {
    return NextResponse.json({ feil: 'Ikke autorisert' }, { status: 401 })
  }

  const parametertema = request.nextUrl.searchParams.get('tema')
  if (parametertema !== null && !erTema(parametertema)) {
    return NextResponse.json(
      { feil: `Ukjent tema «${parametertema}». Tilgjengelig: ${TEMAER.join(', ')}.` },
      { status: 400 }
    )
  }
  const temaer = parametertema !== null ? [parametertema] : TEMAER

  const resultater = []
  for (const tema of temaer) {
    const start = Date.now()
    try {
      const { forsokt } = await oppdaterUsynkroniserte(tema)
      const svar = await lesDatasett(tema)
      resultater.push({
        tema,
        kilderForsokt: forsokt,
        status: svar?.status ?? 'ikke_hentet',
        hentet: svar?.datasett.hentet ?? null,
        rader: svar
          ? svar.datasett.fakta.length + (svar.datasett.befolkning?.length ?? 0) + (svar.datasett.resultater?.length ?? 0)
          : 0,
        advarsler: svar?.datasett.advarsler?.length ?? 0,
        feil: svar?.feil,
        ms: Date.now() - start,
      })
    } catch (e) {
      resultater.push({
        tema,
        kilderForsokt: [],
        status: 'mislyktes' as const,
        feil: e instanceof Error ? e.message : String(e),
        ms: Date.now() - start,
      })
    }
  }

  const ok = resultater.every((r) => r.status === 'fersk' || r.status === 'lagret')
  return NextResponse.json({ ok, resultater }, { status: ok ? 200 : 500 })
}
