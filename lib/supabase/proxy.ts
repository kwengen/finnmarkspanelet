import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAuthConfig } from './auth-server'

const PUBLIC_PATHS = ['/login', '/auth/callback']

function erOffentligSti(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) || pathname.startsWith('/api/auth/')
}

function medSupabaseCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie)
  return target
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname
  let config: ReturnType<typeof supabaseAuthConfig>

  try {
    config = supabaseAuthConfig()
  } catch {
    if (erOffentligSti(pathname)) return NextResponse.next()
    return NextResponse.redirect(new URL('/login?error=config', request.url))
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  const offentlig = erOffentligSti(pathname)

  if (!claims && !offentlig) {
    const login = new URL('/login', request.url)
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return medSupabaseCookies(NextResponse.redirect(login), response)
  }

  if (claims && pathname === '/login') {
    return medSupabaseCookies(NextResponse.redirect(new URL('/', request.url)), response)
  }

  return response
}
