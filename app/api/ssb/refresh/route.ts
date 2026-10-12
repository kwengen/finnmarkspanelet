import { NextResponse, type NextRequest } from 'next/server'
import { isIdentity, requireApiRole } from '@/lib/auth'
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
 * Ruten krever superadministrator-sesjon. Den finnes i tillegg til panelet
 * for intern drift og første gangs kjøring.
 *
 * Sperren beskytter ingen hemmelighet — alt her er offentlig SSB-statistikk.
 * Den beskytter SSBs kallgrense (30 spørringer/minutt per IP) og vår egen
 * funksjonstid mot at hvem som helst kan trykke på knappen i en løkke.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const access = await requireApiRole(request, ['superadministrator'])
  if (!isIdentity(access)) return access

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
