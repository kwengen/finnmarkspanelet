import { NextResponse, type NextRequest } from 'next/server'
import { isIdentity, requireApiRole, type AppRole } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'

const ROLES: readonly AppRole[] = ['superadministrator', 'administrator', 'bruker']

function erRole(value: unknown): value is AppRole {
  return typeof value === 'string' && ROLES.includes(value as AppRole)
}

async function rolleFor(service: Awaited<ReturnType<typeof createServiceClient>>, userId: string): Promise<AppRole | null> {
  const { data, error } = await service.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return erRole(data?.role) ? data.role : null
}

async function antallSuperadministratorer(service: Awaited<ReturnType<typeof createServiceClient>>): Promise<number> {
  const { count, error } = await service
    .from('user_roles')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'superadministrator')
  if (error) throw error
  return count ?? 0
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(request, ['superadministrator', 'administrator'])
  if (!isIdentity(access)) return access
  const { id } = await params
  if (id === access.user.id) return NextResponse.json({ error: 'Du kan ikke endre din egen tilgang.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'role')
  const hasActive = Object.prototype.hasOwnProperty.call(body, 'active')
  if (!hasRole && !hasActive) return NextResponse.json({ error: 'Ingen endring oppgitt.' }, { status: 400 })
  if (hasRole && !erRole(body.role)) return NextResponse.json({ error: 'Ugyldig rolle.' }, { status: 400 })
  if (hasActive && typeof body.active !== 'boolean') return NextResponse.json({ error: '«active» må være true eller false.' }, { status: 400 })

  try {
    const service = await createServiceClient()
    const currentRole = await rolleFor(service, id)
    if (!currentRole) return NextResponse.json({ error: 'Brukeren har ingen gyldig rolle.' }, { status: 404 })
    if (access.role === 'administrator' && (currentRole !== 'bruker' || hasRole)) {
      return NextResponse.json({ error: 'Administratorer kan bare aktivere eller deaktivere vanlige brukere.' }, { status: 403 })
    }
    if (hasRole && access.role === 'superadministrator' && currentRole === 'superadministrator' && body.role !== 'superadministrator') {
      if ((await antallSuperadministratorer(service)) <= 1) {
        return NextResponse.json({ error: 'Det må alltid finnes minst én superadministrator.' }, { status: 400 })
      }
    }

    if (hasRole) {
      const { error } = await service.from('user_roles').update({ role: body.role, updated_at: new Date().toISOString() }).eq('user_id', id)
      if (error) throw error
    }
    if (hasActive) {
      const { error } = await service.auth.admin.updateUserById(id, {
        ban_duration: body.active ? 'none' : '876000h',
      })
      if (error) throw error
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Kunne ikke endre bruker', error)
    return NextResponse.json({ error: 'Brukeren kunne ikke endres.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(request, ['superadministrator', 'administrator'])
  if (!isIdentity(access)) return access
  const { id } = await params

  try {
    const service = await createServiceClient()
    const { data: userResult, error: userError } = await service.auth.admin.getUserById(id)
    if (userError || !userResult.user) {
      return NextResponse.json({ error: 'Brukeren ble ikke funnet.' }, { status: 404 })
    }

    const user = userResult.user
    if (user.email_confirmed_at) {
      return NextResponse.json({
        error: 'Denne brukeren har allerede aktivert kontoen. Send ny invitasjon bare til brukere som står som invitert.',
      }, { status: 400 })
    }
    if (!user.email) {
      return NextResponse.json({ error: 'Brukeren mangler e-postadresse.' }, { status: 400 })
    }

    const currentRole = await rolleFor(service, id)
    if (!currentRole) return NextResponse.json({ error: 'Brukeren har ingen gyldig rolle.' }, { status: 404 })
    if (access.role === 'administrator' && currentRole !== 'bruker') {
      return NextResponse.json({ error: 'Administratorer kan bare sende nye invitasjoner til vanlige brukere.' }, { status: 403 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin
    const redirectTo = `${siteUrl}/auth/callback?next=/sett-passord`
    const { error: resendError } = await service.auth.resend({
      type: 'signup',
      email: user.email,
      options: { emailRedirectTo: redirectTo },
    })

    if (!resendError) return NextResponse.json({ ok: true, sent: true })

    // Enkelte Supabase-oppsett støtter ikke resend av en invitasjonstype.
    // Generer da en ny engangslenke uten å slette eller endre brukeren.
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: 'invite',
      email: user.email,
      options: { redirectTo },
    })
    const actionLink = linkData?.properties?.action_link
    if (linkError || !actionLink) {
      return NextResponse.json({
        error: 'Ny invitasjon kunne ikke sendes. Be administratoren prøve igjen, eller opprett en ny invitasjon til brukeren.',
      }, { status: 400 })
    }

    return NextResponse.json({ ok: true, sent: false, actionLink })
  } catch (error) {
    console.error('Kunne ikke sende ny invitasjon', error)
    return NextResponse.json({ error: 'Den nye invitasjonen kunne ikke sendes.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(request, ['superadministrator', 'administrator'])
  if (!isIdentity(access)) return access
  const { id } = await params
  if (id === access.user.id) return NextResponse.json({ error: 'Du kan ikke slette din egen bruker.' }, { status: 400 })

  try {
    const service = await createServiceClient()
    const currentRole = await rolleFor(service, id)
    if (!currentRole) return NextResponse.json({ error: 'Brukeren har ingen gyldig rolle.' }, { status: 404 })
    if (access.role === 'administrator' && currentRole !== 'bruker') {
      return NextResponse.json({ error: 'Administratorer kan bare slette vanlige brukere.' }, { status: 403 })
    }
    if (currentRole === 'superadministrator' && (await antallSuperadministratorer(service)) <= 1) {
      return NextResponse.json({ error: 'Det må alltid finnes minst én superadministrator.' }, { status: 400 })
    }
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Kunne ikke slette bruker', error)
    return NextResponse.json({ error: 'Brukeren kunne ikke slettes.' }, { status: 500 })
  }
}
