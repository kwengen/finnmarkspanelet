import { NextResponse, type NextRequest } from 'next/server'
import { isIdentity, requireApiRole, type AppRole } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'

const ROLES: readonly AppRole[] = ['superadministrator', 'administrator', 'bruker']

function erRole(value: unknown): value is AppRole {
  return typeof value === 'string' && ROLES.includes(value as AppRole)
}

async function listAllUsers(service: Awaited<ReturnType<typeof createServiceClient>>) {
  const users = []
  const perPage = 1000
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < perPage) break
  }
  return users
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const access = await requireApiRole(request, ['superadministrator', 'administrator'])
  if (!isIdentity(access)) return access

  try {
    const service = await createServiceClient()
    const [users, rolesResult] = await Promise.all([
      listAllUsers(service),
      service.from('user_roles').select('user_id, role'),
    ])
    if (rolesResult.error) throw rolesResult.error
    const roles = new Map(rolesResult.data.map((row) => [row.user_id, row.role as AppRole]))

    return NextResponse.json({
      users: users
        .map((user) => ({
          id: user.id,
          email: user.email,
          role: roles.get(user.id) ?? null,
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at,
          confirmed: Boolean(user.email_confirmed_at),
          active: !user.banned_until || new Date(user.banned_until).getTime() <= Date.now(),
        }))
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '', 'nb')),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Kunne ikke hente brukere', error)
    return NextResponse.json({ error: 'Kunne ikke hente brukere.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const access = await requireApiRole(request, ['superadministrator', 'administrator'])
  if (!isIdentity(access)) return access

  const body = await request.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const requestedRole = body?.role ?? 'bruker'
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'Oppgi en gyldig e-postadresse.' }, { status: 400 })
  if (!erRole(requestedRole)) return NextResponse.json({ error: 'Ugyldig rolle.' }, { status: 400 })
  if (access.role === 'administrator' && requestedRole !== 'bruker') {
    return NextResponse.json({ error: 'Administratorer kan bare opprette brukere.' }, { status: 403 })
  }

  try {
    const service = await createServiceClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/sett-passord`,
    })
    if (error || !data.user) return NextResponse.json({ error: error?.message ?? 'Invitasjonen kunne ikke sendes.' }, { status: 400 })

    const { error: roleError } = await service.from('user_roles').upsert({
      user_id: data.user.id,
      role: requestedRole,
    })
    if (roleError) {
      await service.auth.admin.deleteUser(data.user.id)
      throw roleError
    }
    return NextResponse.json({ ok: true, userId: data.user.id })
  } catch (error) {
    console.error('Kunne ikke invitere bruker', error)
    return NextResponse.json({ error: 'Brukeren kunne ikke opprettes.' }, { status: 500 })
  }
}
