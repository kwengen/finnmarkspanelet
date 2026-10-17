import { NextResponse, type NextRequest } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function loginForInvite(request: NextRequest, next: string) {
  const login = new URL('/login', request.url)
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}

function loginWithInviteError(request: NextRequest, next: string) {
  const login = new URL('/login', request.url)
  login.searchParams.set('next', next)
  login.searchParams.set('error', 'invite_expired')
  return NextResponse.redirect(login)
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))
  if (!code) return loginForInvite(request, next)

  try {
    const supabase = await createAuthServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return loginWithInviteError(request, next)
    return NextResponse.redirect(new URL(next, request.url))
  } catch (error) {
    console.error('Auth callback feilet', error)
    return NextResponse.redirect(new URL('/login?error=config', request.url))
  }
}
