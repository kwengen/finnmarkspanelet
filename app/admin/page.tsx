import { requirePageRole } from '@/lib/auth'
import KilderPanel from './kilder-panel'
/** Systemadministrasjon er forbeholdt superadministratorer. */
export default async function AdminPage() {
  await requirePageRole(['superadministrator'])

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <KilderPanel />
      <a href="/" className="inline-block text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
        Tilbake til panelet
      </a>
    </main>
  )
}
