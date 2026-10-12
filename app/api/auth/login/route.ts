import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'E-post og passord må fylles ut.' }, { status: 400 })
  }

  try {
    const supabase = await createAuthServerClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return NextResponse.json({ error: 'Feil e-post eller passord.' }, { status: 401 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Innlogging feilet', error)
    return NextResponse.json({ error: 'Innlogging er ikke konfigurert.' }, { status: 503 })
  }
}
