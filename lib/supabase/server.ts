import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side klient for databaseoperasjoner.
 *
 * Finnmarkspanelet har ingen brukerinnlogging, og derfor bare denne ene
 * klienten. Den er bevisst uten cookie-lager: ingen forespørsel skal kunne
 * påvirke hvilken rolle databasen ser.
 *
 * `ssb_datasett` og `ssb_kilder` har RLS med en policy som bare slipper
 * `service_role` til, så all lesing og skriving går gjennom denne klienten og
 * aldri direkte fra nettleseren.
 */
export async function createServiceClient(): Promise<SupabaseClient> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )
}
