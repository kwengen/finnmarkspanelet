import { requirePageRole } from '@/lib/auth'
import UserAdminPanel from './user-admin-panel'

export default async function UsersPage() {
  const identity = await requirePageRole(['superadministrator', 'administrator'])

  return (
    <main className="min-h-full bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-red-700 font-semibold">Finnmarkspanelet</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">Brukere</h1>
            <p className="mt-1 text-sm text-zinc-500">Inviter, aktiver, deaktiver og fjern brukere fra portalen.</p>
          </div>
          <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900">Til panelet</a>
        </div>
        <UserAdminPanel role={identity.role} />
      </div>
    </main>
  )
}
