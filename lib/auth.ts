import type { User } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

export const APP_ROLES = ['superadministrator', 'administrator', 'bruker'] as const
export type AppRole = (typeof APP_ROLES)[number]

export interface CurrentIdentity {
  user: User
  role: AppRole
}

function erAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
}

async function bootstrapSuperadministrator(user: User): Promise<AppRole | null> {
  const bootstrapEmail = process.env.FINNMARK_BOOTSTRAP_SUPERADMIN_EMAIL?.trim().toLowerCase()
  if (!bootstrapEmail || user.email?.toLowerCase() !== bootstrapEmail) return null

  const service = await createServiceClient()
  const { count, error: countError } = await service
    .from('user_roles')
    .select('user_id', { count: 'exact', head: true })
  if (countError) throw countError
  if ((count ?? 0) !== 0) return null

  const { error } = await service.from('user_roles').insert({
    user_id: user.id,
    role: 'superadministrator',
  })
  if (error && error.code !== '23505') throw error
  return 'superadministrator'
}

export async function getCurrentIdentity(): Promise<CurrentIdentity | null> {
  const auth = await createAuthServerClient()
  const { data: { user }, error } = await auth.auth.getUser()
  if (error || !user) return null

  const service = await createServiceClient()
  const { data: row, error: roleError } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (roleError) throw roleError

  const role = erAppRole(row?.role) ? row.role : await bootstrapSuperadministrator(user)
  return role ? { user, role } : null
}

export async function requireIdentity(): Promise<CurrentIdentity> {
  const identity = await getCurrentIdentity()
  if (!identity) throw new AuthRequiredError()
  return identity
}

export async function requireApiRole(request: NextRequest, roles: readonly AppRole[]): Promise<CurrentIdentity | NextResponse> {
  try {
    const identity = await getCurrentIdentity()
    if (!identity) return NextResponse.json({ error: 'Innlogging kreves.' }, { status: 401 })
    if (!roles.includes(identity.role)) return NextResponse.json({ error: 'Du har ikke tilgang.' }, { status: 403 })
    return identity
  } catch (error) {
    console.error('Autentisering feilet', error)
    return NextResponse.json({ error: 'Autentisering er ikke konfigurert.' }, { status: 503 })
  }
}

export async function requirePageRole(roles: readonly AppRole[]): Promise<CurrentIdentity> {
  const identity = await getCurrentIdentity()
  if (!identity) redirect('/login')
  if (!roles.includes(identity.role)) redirect('/')
  return identity
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Innlogging kreves.')
    this.name = 'AuthRequiredError'
  }
}

export function isIdentity(value: CurrentIdentity | NextResponse): value is CurrentIdentity {
  return value instanceof Object && 'user' in value && 'role' in value
}

export function canManageUsers(role: AppRole): boolean {
  return role === 'superadministrator' || role === 'administrator'
}

export function isSuperadministrator(role: AppRole): boolean {
  return role === 'superadministrator'
}
