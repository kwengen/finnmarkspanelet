import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function POST() {
  try {
    const supabase = await createAuthServerClient()
    await supabase.auth.signOut()
  } catch (error) {
    console.error('Utlogging feilet', error)
  }
  return NextResponse.json({ ok: true })
}
