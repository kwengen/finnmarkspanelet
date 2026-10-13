import { NextResponse, type NextRequest } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function loginWithInviteError(request: NextRequest) {
  return NextResponse.redirect(new URL('/login?error=invite_expired', request.url))
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))
  if (!code) return loginWithInviteError(request)

  try {
    const supabase = await createAuthServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return loginWithInviteError(request)
    return NextResponse.redirect(new URL(next, request.url))
  } catch (error) {
    console.error('Auth callback feilet', error)
    return NextResponse.redirect(new URL('/login?error=config', request.url))
  }
}
