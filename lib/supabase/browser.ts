'use client'

import { createBrowserClient, type SupabaseClient } from '@supabase/ssr'

let browserClient: SupabaseClient | undefined

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase-klienten er ikke konfigurert.')

  browserClient = createBrowserClient(url, key)
  return browserClient
}
