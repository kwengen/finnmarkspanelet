/**
 * Lageret for siste gyldige SSB-uttrekk (ssb_datasett) og for hver
 * underliggende kildes egen hurtigbuffer/henteflagg (ssb_kilder).
 *
 * Dette er den eneste fila i lib/ssb som kjenner Supabase. Skal SSB-laget
 * flyttes til en annen deploy, er det bare denne som må skrives om.
 */
import { createServiceClient } from '@/lib/supabase/server'
import type { KildePayload, KildeRad } from './kilder'
import type { Datasett, Tema } from './types'

export interface LagretRad {
  datasett: Datasett
  sistForsokt: string | null
  sisteFeil: string | null
  feilSiden: string | null
  antallFeil: number
}

export async function lesLagret(tema: Tema): Promise<LagretRad | null> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('ssb_datasett')
    .select('payload, sist_forsokt, siste_feil, feil_siden, antall_feil')
    .eq('tema', tema)
    .maybeSingle()

  if (error) throw new Error(`Kunne ikke lese ssb_datasett: ${error.message}`)
  if (!data) return null

  return {
    datasett: data.payload as Datasett,
    sistForsokt: data.sist_forsokt,
    sisteFeil: data.siste_feil,
    feilSiden: data.feil_siden,
    antallFeil: data.antall_feil ?? 0,
  }
}

/** Skriver et uttrekk som har bestått valideringen, og nullstiller feiltellingen. */
export async function lagreGyldig(tema: Tema, datasett: Datasett): Promise<void> {
  const supabase = await createServiceClient()
  const { error } = await supabase.from('ssb_datasett').upsert(
    {
      tema,
      kontrakt: datasett.kontrakt,
      kilde: datasett.kilde,
      hentet: datasett.hentet,
      payload: datasett,
      advarsler: datasett.advarsler ?? [],
      sist_forsokt: new Date().toISOString(),
      siste_feil: null,
      feil_siden: null,
      antall_feil: 0,
      oppdatert: new Date().toISOString(),
    },
    { onConflict: 'tema' }
  )
  if (error) throw new Error(`Kunne ikke lagre ssb_datasett: ${error.message}`)
}

/**
 * Noterer et mislykket forsøk uten å røre payload.
 *
 * `feil_siden` settes bare første gang, slik at den svarer på «hvor lenge har
 * dette vært nede» og ikke «når feilet det sist».
 */
export async function noterFeil(tema: Tema, melding: string, fantesFraFor: boolean): Promise<void> {
  const supabase = await createServiceClient()
  const na = new Date().toISOString()

  if (!fantesFraFor) {
    // Ingen rad å oppdatere ennå, og vi har ingen payload å skrive. Feilen
    // logges av kalleren; her er det ingenting å ta vare på.
    return
  }

  const { data } = await supabase
    .from('ssb_datasett')
    .select('feil_siden, antall_feil')
    .eq('tema', tema)
    .maybeSingle()

  const { error } = await supabase
    .from('ssb_datasett')
    .update({
      sist_forsokt: na,
      siste_feil: melding.slice(0, 2000),
      feil_siden: data?.feil_siden ?? na,
      antall_feil: (data?.antall_feil ?? 0) + 1,
      oppdatert: na,
    })
    .eq('tema', tema)

  if (error) throw new Error(`Kunne ikke notere SSB-feil: ${error.message}`)
}

/* ── ssb_kilder: én rad per underliggende kilde, ikke per tema ────────────── */

interface KildeRadDb {
  id: string
  tema: Tema
  navn: string
  kilde: string
  payload: KildePayload | null
  hentet: string | null
  sist_forsokt: string | null
  siste_feil: string | null
  feil_siden: string | null
  antall_feil: number | null
  tvungen_oppdatering: boolean | null
}

function radTilKilde(rad: KildeRadDb): KildeRad {
  return {
    id: rad.id,
    tema: rad.tema,
    navn: rad.navn,
    kilde: rad.kilde,
    payload: rad.payload,
    hentet: rad.hentet,
    sistForsokt: rad.sist_forsokt,
    sisteFeil: rad.siste_feil,
    feilSiden: rad.feil_siden,
    antallFeil: rad.antall_feil ?? 0,
    tvungenOppdatering: rad.tvungen_oppdatering ?? false,
  }
}

export async function lesAlleKilder(): Promise<KildeRad[]> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase.from('ssb_kilder').select('*')
  if (error) throw new Error(`Kunne ikke lese ssb_kilder: ${error.message}`)
  return (data ?? []).map(radTilKilde)
}

export async function lesKilde(id: string): Promise<KildeRad | null> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase.from('ssb_kilder').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Kunne ikke lese kilde ${id}: ${error.message}`)
  return data ? radTilKilde(data) : null
}

/**
 * Oppretter en stub-rad (payload=null, aldri hentet) for hver kilde i
 * registeret som ikke allerede finnes — idempotent, gjør ingenting med
 * kilder som allerede har en rad. Kalles av admin-listeendepunktet, slik at
 * avmerkingsboksen og statuslisten alltid har noe å vise/oppdatere selv før
 * første henting.
 */
export async function sikreKilderRader(registrerte: Array<{ id: string; tema: Tema; navn: string; kilde: string }>): Promise<void> {
  const supabase = await createServiceClient()
  const na = new Date().toISOString()
  const { error } = await supabase.from('ssb_kilder').upsert(
    registrerte.map((r) => ({ id: r.id, tema: r.tema, navn: r.navn, kilde: r.kilde, oppdatert: na })),
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (error) throw new Error(`Kunne ikke sikre kilderader: ${error.message}`)
}

/** Skriver en kildes payload etter en vellykket henting, og nullstiller feiltelling/flagg. */
export async function lagreKildeSuksess(
  id: string,
  meta: { tema: Tema; navn: string; kilde: string },
  payload: KildePayload
): Promise<void> {
  const supabase = await createServiceClient()
  const na = new Date().toISOString()
  const { error } = await supabase.from('ssb_kilder').upsert(
    {
      id,
      tema: meta.tema,
      navn: meta.navn,
      kilde: meta.kilde,
      payload,
      hentet: na,
      sist_forsokt: na,
      siste_feil: null,
      feil_siden: null,
      antall_feil: 0,
      tvungen_oppdatering: false,
      oppdatert: na,
    },
    { onConflict: 'id' }
  )
  if (error) throw new Error(`Kunne ikke lagre kilde ${id}: ${error.message}`)
}

/**
 * Noterer et mislykket forsøk for én kilde, uten å røre payload/hentet.
 * tvungen_oppdatering beholdes bevisst — et mislykket tvunget forsøk skal
 * fortsatt være flagget for et nytt forsøk, ikke stille forsvinne.
 */
export async function noterKildeFeil(
  id: string,
  meta: { tema: Tema; navn: string; kilde: string },
  melding: string
): Promise<void> {
  const supabase = await createServiceClient()
  const na = new Date().toISOString()

  const { data } = await supabase.from('ssb_kilder').select('feil_siden, antall_feil').eq('id', id).maybeSingle()

  const { error } = await supabase.from('ssb_kilder').upsert(
    {
      id,
      tema: meta.tema,
      navn: meta.navn,
      kilde: meta.kilde,
      sist_forsokt: na,
      siste_feil: melding.slice(0, 2000),
      feil_siden: data?.feil_siden ?? na,
      antall_feil: (data?.antall_feil ?? 0) + 1,
      oppdatert: na,
    },
    { onConflict: 'id' }
  )
  if (error) throw new Error(`Kunne ikke notere kildefeil for ${id}: ${error.message}`)
}

/** Setter/fjerner avmerkingsboksen «oppdater denne kilden uansett ved neste kjøring». */
export async function settTvungenOppdatering(id: string, tvungen: boolean): Promise<void> {
  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('ssb_kilder')
    .update({ tvungen_oppdatering: tvungen, oppdatert: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Kunne ikke sette tvungen_oppdatering for ${id}: ${error.message}`)
}
