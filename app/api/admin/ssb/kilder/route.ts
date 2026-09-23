import { NextResponse, type NextRequest } from 'next/server'
import { avvisUautorisertAdmin } from '@/lib/admin-auth'
import { KILDE_REGISTRY } from '@/lib/ssb'
import { lesAlleKilder, sikreKilderRader } from '@/lib/ssb/store'

/**
 * GET /api/admin/ssb/kilder
 *
 * Status per underliggende kilde (SSB-tabell/ekstern API), til
 * /admin. Leser bare lageret — gjør aldri et SSB-kall selv.
 */
export async function GET(request: NextRequest) {
  const avvist = avvisUautorisertAdmin(request)
  if (avvist) return avvist

  try {
    // Sikrer at hver registrerte kilde har en rad å vise/oppdatere, selv om
    // den aldri er hentet ennå.
    await sikreKilderRader(KILDE_REGISTRY)
    const rader = await lesAlleKilder()

    const kilder = KILDE_REGISTRY.map((def) => {
      const rad = rader.find((r) => r.id === def.id)
      return {
        id: def.id,
        tema: def.tema,
        navn: def.navn,
        kilde: def.kilde,
        hentet: rad?.hentet ?? null,
        status: !rad?.hentet ? ('aldri_hentet' as const) : rad.sisteFeil ? ('feilet' as const) : ('ok' as const),
        antallRader:
          (rad?.payload?.fakta?.length ?? 0) +
          (rad?.payload?.befolkning?.length ?? 0) +
          (rad?.payload?.resultater?.length ?? 0),
        feil: rad?.sisteFeil ?? null,
        feilSiden: rad?.feilSiden ?? null,
        antallFeil: rad?.antallFeil ?? 0,
        tvungenOppdatering: rad?.tvungenOppdatering ?? false,
        advarsler: rad?.payload?.advarsler ?? [],
      }
    })

    return NextResponse.json({ kilder })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
