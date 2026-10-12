import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} mangler i miljøet`)
  return value
}

function publishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!value) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY mangler i miljøet')
  return value
}

/** Supabase-klient for Route Handlers og Server Components med cookie-sesjon. */
export async function createAuthServerClient() {
  const cookieStore = await cookies()

  return createServerClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), publishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components kan ikke skrive cookies. Proxy håndterer refresh.
        }
      },
    },
  })
}

export function supabaseAuthConfig() {
  return {
    url: requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    key: publishableKey(),
  }
}
