import SetPasswordForm from './set-password-form'

export default function SetPasswordPage() {
  return (
    <main className="min-h-full flex items-center justify-center px-4 py-16 bg-zinc-50">
      <section className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-sm p-8">
        <div className="text-xs uppercase tracking-[0.18em] text-red-700 font-semibold">Finnmarkspanelet</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">Lag passord</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Velg et personlig passord for brukeren din.</p>
        <SetPasswordForm />
      </section>
    </main>
  )
}
