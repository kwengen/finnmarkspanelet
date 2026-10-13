'use client'

import { useEffect, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

const EXPIRED_INVITE_MESSAGE = 'Invitasjonslenken har gått ut eller er allerede brukt. Be administratoren om å sende en ny invitasjon.'

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = fragment.get('access_token')
    const refreshToken = fragment.get('refresh_token')
    const errorCode = fragment.get('error_code')
    const description = fragment.get('error_description')?.toLowerCase() ?? ''
    const isExpiredInvite = errorCode === 'otp_expired'
      || description.includes('expired')
      || description.includes('invalid')

    if (accessToken && refreshToken) {
      setLoading(true)
      async function restoreSession() {
        try {
          const supabase = createBrowserSupabaseClient()
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) throw sessionError
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          window.location.assign(next === '/' ? '/sett-passord' : next)
        } catch {
          setError('Invitasjonslenken kunne ikke brukes. Be administratoren om å sende en ny invitasjon.')
        } finally {
          setLoading(false)
        }
      }
      void restoreSession()
      return
    }

    if (isExpiredInvite) {
      setError(EXPIRED_INVITE_MESSAGE)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [next])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? 'Kunne ikke logge inn.')
        return
      }
      window.location.assign(next)
    } catch {
      setError('Nettverksfeil. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  async function bootstrap(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? 'Kunne ikke opprette superadministratoren.')
        return
      }
      if (data.emailConfirmationRequired) {
        setMessage('Sjekk e-posten din og bekreft kontoen før du logger inn.')
        return
      }
      window.location.assign(next)
    } catch {
      setError('Nettverksfeil. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-medium text-zinc-700">
        E-post
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
      </label>
      <label className="block text-sm font-medium text-zinc-700">
        Passord
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Logger inn …' : 'Logg inn'}
      </button>
      <div className="border-t border-zinc-200 pt-4">
        <p className="text-xs leading-5 text-zinc-500">Første gang? Opprett tilgang med bootstrap-adressen.</p>
        <button
          type="button"
          onClick={bootstrap}
          disabled={loading}
          className="mt-2 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Oppretter …' : 'Opprett første superadministrator'}
        </button>
      </div>
    </form>
  )
}
