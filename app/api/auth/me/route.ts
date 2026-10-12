import { NextResponse } from 'next/server'
import { getCurrentIdentity } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const identity = await getCurrentIdentity()
    if (!identity) return NextResponse.json({ authenticated: false }, { status: 401 })
    return NextResponse.json({
      authenticated: true,
      email: identity.user.email,
      role: identity.role,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Kunne ikke lese innlogget bruker', error)
    return NextResponse.json({ error: 'Autentisering er ikke konfigurert.' }, { status: 503 })
  }
}
