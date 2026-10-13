import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

function siteUrl(request: Request): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://finnmarkspanelet.vercel.app').replace(/\/$/, '')
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const bootstrapEmail = process.env.FINNMARK_BOOTSTRAP_SUPERADMIN_EMAIL?.trim().toLowerCase()

  if (!email || !password) {
    return NextResponse.json({ error: 'E-post og passord må fylles ut.' }, { status: 400 })
  }
  if (!bootstrapEmail || email !== bootstrapEmail) {
    return NextResponse.json({ error: 'Denne opprettelsen er kun tilgjengelig for bootstrap-adressen.' }, { status: 403 })
  }

  try {
    const service = await createServiceClient()
    const { count, error: countError } = await service
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
    if (countError) throw countError
    if ((count ?? 0) !== 0) {
      return NextResponse.json({ error: 'Første superadministrator er allerede opprettet.' }, { status: 409 })
    }

    const supabase = await createAuthServerClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${siteUrl(request)}/auth/callback` },
    })
    if (error) {
      return NextResponse.json({ error: 'Kontoen kan ikke opprettes. Prøv å logge inn eller be om en ny invitasjon.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, emailConfirmationRequired: !data.session })
  } catch (error) {
    console.error('Bootstrap-opprettelse feilet', error)
    return NextResponse.json({ error: 'Opprettelse er ikke konfigurert.' }, { status: 503 })
  }
}
