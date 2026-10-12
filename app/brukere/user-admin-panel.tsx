'use client'

import { useEffect, useState } from 'react'
import type { AppRole } from '@/lib/auth'

interface ManagedUser {
  id: string
  email: string | undefined
  role: AppRole | null
  createdAt: string
  lastSignInAt: string | null
  confirmed: boolean
  active: boolean
}

const ROLE_LABEL: Record<AppRole, string> = {
  superadministrator: 'Superadministrator',
  administrator: 'Administrator',
  bruker: 'Bruker',
}

function formatDate(value: string | null): string {
  if (!value) return 'aldri'
  return new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium' }).format(new Date(value))
}

export default function UserAdminPanel({ role }: { role: AppRole }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<AppRole>('bruker')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Kunne ikke hente brukere.')
      setUsers(Array.isArray(data.users) ? data.users : [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kunne ikke hente brukere.')
    } finally {
      setLoading(false)
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadUsers()
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: role === 'administrator' ? 'bruker' : newRole }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Invitasjonen kunne ikke sendes.')
      setEmail('')
      setMessage('Invitasjonen er sendt på e-post.')
      await loadUsers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitasjonen kunne ikke sendes.')
    } finally {
      setSaving(false)
    }
  }

  async function updateUser(id: string, changes: { role?: AppRole; active?: boolean }) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error ?? 'Brukeren kunne ikke endres.')
    setMessage('Brukeren er oppdatert.')
    await loadUsers()
  }

  async function removeUser(user: ManagedUser) {
    if (!window.confirm(`Slette ${user.email ?? 'brukeren'}? Dette kan ikke angres.`)) return
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Brukeren kunne ikke slettes.')
      setMessage('Brukeren er slettet.')
      await loadUsers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Brukeren kunne ikke slettes.')
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Inviter ny bruker</h2>
        <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
          <label className="block text-sm font-medium text-zinc-700">
            E-post
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200" />
          </label>
          {role === 'superadministrator' ? (
            <label className="block text-sm font-medium text-zinc-700">
              Rolle
              <select value={newRole} onChange={(event) => setNewRole(event.target.value as AppRole)} className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200">
                {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : (
            <p className="pb-2 text-sm text-zinc-500">Administratorer kan invitere vanlige brukere.</p>
          )}
          <button type="submit" disabled={saving} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Sender …' : 'Send invitasjon'}
          </button>
        </form>
      </section>

      {message && <p className="text-sm text-green-700" role="status">{message}</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">Registrerte brukere</h2>
        </div>
        {loading ? <p className="px-5 py-8 text-sm text-zinc-500">Laster brukere …</p> : users.length === 0 ? <p className="px-5 py-8 text-sm text-zinc-500">Ingen brukere funnet.</p> : (
          <div className="divide-y divide-zinc-100">
            {users.map((user) => (
              <div key={user.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-900">{user.email ?? '(uten e-post)'}</span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600">{user.role ? ROLE_LABEL[user.role] : 'Uten rolle'}</span>
                    {!user.active && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">Deaktivert</span>}
                    {!user.confirmed && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Invitert</span>}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Opprettet {formatDate(user.createdAt)} · Sist innlogget {formatDate(user.lastSignInAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {role === 'superadministrator' && user.role && (
                    <select value={user.role} onChange={(event) => void updateUser(user.id, { role: event.target.value as AppRole }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Brukeren kunne ikke endres.'))} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700">
                      {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => void updateUser(user.id, { active: !user.active }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Brukeren kunne ikke endres.'))} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                    {user.active ? 'Deaktiver' : 'Aktiver'}
                  </button>
                  <button type="button" onClick={() => void removeUser(user)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                    Slett
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
