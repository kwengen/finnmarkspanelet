import { NextRequest, NextResponse } from 'next/server'
import { avvisUautorisertAdmin } from '@/lib/admin-auth'
import { oppdaterUsynkroniserte, tvingKilde, erTema } from '@/lib/ssb'
import { finnKildeDef } from '@/lib/ssb/kilder'

/**
 * POST /api/admin/ssb/kilder/refresh
 * Body: { kildeId: string } — tving akkurat denne kilden på nytt, uansett status.
 *   eller: { tema?: string } / {} — hent bare kilder som mangler, sist
 *   feilet, eller er eksplisitt flagget for tvungen oppdatering (valgfritt
 *   begrenset til ett tema). Dette er "Hent alle nå"-knappens vanlige modus.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const avvist = avvisUautorisertAdmin(request)
  if (avvist) return avvist

  try {
    const body = await request.json().catch(() => ({}))

    if (typeof body?.kildeId === 'string') {
      if (!finnKildeDef(body.kildeId)) {
        return NextResponse.json({ error: `Ukjent kilde «${body.kildeId}».` }, { status: 400 })
      }
      await tvingKilde(body.kildeId)
      return NextResponse.json({ ok: true, forsokt: [body.kildeId] })
    }

    const tema = typeof body?.tema === 'string' ? body.tema : undefined
    if (tema !== undefined && !erTema(tema)) {
      return NextResponse.json({ error: `Ukjent tema «${tema}».` }, { status: 400 })
    }

    const { forsokt } = await oppdaterUsynkroniserte(tema)
    return NextResponse.json({ ok: true, forsokt })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
