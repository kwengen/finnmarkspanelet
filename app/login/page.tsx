import LoginForm from './login-form'

const EXPIRED_INVITE_MESSAGE = 'Invitasjonslenken har gått ut eller er allerede brukt. Be administratoren om å sende en ny invitasjon.'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : '/'
  const inviteError = params.error === 'invite' || params.error === 'invite_expired'

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-16 bg-zinc-50">
      <section className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-sm p-8">
        <div className="text-xs uppercase tracking-[0.18em] text-red-700 font-semibold">Finnmark Arbeiderparti</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">Finnmarkspanelet</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Logg inn for å bruke portalen.</p>
        {inviteError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800" role="alert">
            {EXPIRED_INVITE_MESSAGE}
          </p>
        )}
        {params.error === 'config' && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Innlogging er ikke ferdig konfigurert på serveren ennå.
          </p>
        )}
        <LoginForm next={next} />
      </section>
    </main>
  )
}
