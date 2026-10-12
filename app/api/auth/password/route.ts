import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8) return NextResponse.json({ error: 'Passordet må ha minst 8 tegn.' }, { status: 400 })

  try {
    const supabase = await createAuthServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Innlogging kreves.' }, { status: 401 })
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return NextResponse.json({ error: 'Kunne ikke lagre passordet.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Passordoppdatering feilet', error)
    return NextResponse.json({ error: 'Autentisering er ikke konfigurert.' }, { status: 503 })
  }
}
