import { NextRequest, NextResponse } from 'next/server'
import { avvisUautorisertAdmin } from '@/lib/admin-auth'
import { finnKildeDef, KILDE_REGISTRY } from '@/lib/ssb/kilder'
import { sikreKilderRader, settTvungenOppdatering } from '@/lib/ssb/store'

/**
 * POST /api/admin/ssb/kilder/flagg
 * Body: { kildeId: string; tvungen: boolean }
 *
 * Setter/fjerner avmerkingsboksen "oppdater denne kilden ved neste kjøring
 * av Hent alle nå" — påvirker ikke lagrede tall før noen faktisk henter.
 */
export async function POST(request: NextRequest) {
  const avvist = avvisUautorisertAdmin(request)
  if (avvist) return avvist

  try {
    const body = await request.json().catch(() => ({}))
    const kildeId = body?.kildeId
    const tvungen = body?.tvungen

    if (typeof kildeId !== 'string' || !finnKildeDef(kildeId)) {
      return NextResponse.json({ error: `Ukjent kilde «${kildeId}».` }, { status: 400 })
    }
    if (typeof tvungen !== 'boolean') {
      return NextResponse.json({ error: '«tvungen» må være true eller false.' }, { status: 400 })
    }

    await sikreKilderRader(KILDE_REGISTRY)
    await settTvungenOppdatering(kildeId, tvungen)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
