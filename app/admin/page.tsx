'use client'

import { useState, useSyncExternalStore } from 'react'
import KilderPanel from './kilder-panel'

const LAGER_NOKKEL = 'finnmark_admin_key'

/**
 * Adminnøkkelen ligger i `sessionStorage`: den forsvinner når fanen lukkes,
 * havner aldri i en URL, og deles ikke mellom faner.
 *
 * Lageret leses gjennom `useSyncExternalStore` framfor i en effekt. Da
 * håndterer React selv at tjeneren ikke har noe lager — den prerendrer
 * innloggingsskjemaet, og bytter til panelet først etter hydrering — uten at
 * vi trenger en egen «har lest ennå»-tilstand.
 *
 * `minne` er kilden komponenten leser, og lageret bare det som overlever en
 * omlasting. Er lageret blokkert (privat vindu), virker panelet fortsatt ut
 * fanens levetid i stedet for å låse seg ute.
 */
let minne: string | null | undefined
const lyttere = new Set<() => void>()

function lesFraLager(): string | null {
  try {
    return sessionStorage.getItem(LAGER_NOKKEL)
  } catch {
    return null
  }
}

function hentNokkel(): string | null {
  if (minne === undefined) minne = lesFraLager()
  return minne
}

function settNokkel(verdi: string | null) {
  minne = verdi
  try {
    if (verdi === null) sessionStorage.removeItem(LAGER_NOKKEL)
    else sessionStorage.setItem(LAGER_NOKKEL, verdi)
  } catch {
    // Uten lager lever nøkkelen bare i `minne`. Det er nok for denne fanen.
  }
  for (const lytter of lyttere) lytter()
}

function abonner(lytter: () => void) {
  lyttere.add(lytter)
  return () => {
    lyttere.delete(lytter)
  }
}

/**
 * /admin — adminpanel for kildene bak Finnmarkspanelet.
 *
 * Panelet lå tidligere i TinkrFlows og arvet organisasjonsmodellen derfra.
 * Her er porten én delt nøkkel, fordi det er alt oppgaven krever: panelet
 * styrer hvem som kan utløse et SSB-uttrekk og flagge en kilde, ikke hvem som
 * får se tall. Tallene er offentlig SSB-statistikk uansett.
 */
export default function AdminPage() {
  const nokkel = useSyncExternalStore(abonner, hentNokkel, () => null)
  const [utkast, setUtkast] = useState('')
  const [avvist, setAvvist] = useState(false)

  function loggInn(event: React.FormEvent) {
    event.preventDefault()
    const verdi = utkast.trim()
    if (!verdi) return
    setAvvist(false)
    setUtkast('')
    settNokkel(verdi)
  }

  function glemNokkel(bleAvvist: boolean) {
    setAvvist(bleAvvist)
    settNokkel(null)
  }

  if (!nokkel) {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <h1 className="text-xl font-bold text-zinc-900">Adminnøkkel</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Panelet styrer henting av SSB-data. Tallene det viser er offentlige.
        </p>
        <form onSubmit={loggInn} className="mt-6 space-y-3">
          <input
            type="password"
            value={utkast}
            onChange={(e) => setUtkast(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
          {avvist && <p className="text-sm text-red-600">Nøkkelen ble avvist. Prøv igjen.</p>}
          <button
            type="submit"
            disabled={!utkast.trim()}
            className="w-full px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          >
            Åpne panelet
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <KilderPanel nokkel={nokkel} onAvvist={() => glemNokkel(true)} />
      <button
        onClick={() => glemNokkel(false)}
        className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
      >
        Glem nøkkelen i denne fanen
      </button>
    </main>
  )
}
