'use client'

import { useEffect, useState } from 'react'

interface KildeStatus {
  id: string
  tema: string
  navn: string
  kilde: string
  hentet: string | null
  status: 'ok' | 'feilet' | 'aldri_hentet'
  antallRader: number
  feil: string | null
  feilSiden: string | null
  antallFeil: number
  tvungenOppdatering: boolean
  advarsler: string[]
}

const TEMA_NAVN: Record<string, string> = {
  befolkning: 'Befolkning',
  naering: 'Næring og arbeidsplasser',
  okonomi: 'Kommuneøkonomi',
  valg: 'Valgresultater',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'nå nettopp'
  if (mins < 60) return `${mins} min siden`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} t siden`
  const days = Math.floor(hrs / 24)
  return `${days} dag${days !== 1 ? 'er' : ''} siden`
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-zinc-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function StatusBadge({ status }: { status: KildeStatus['status'] }) {
  const stiler: Record<KildeStatus['status'], string> = {
    ok: 'bg-green-50 text-green-700 border-green-200',
    feilet: 'bg-amber-50 text-amber-800 border-amber-200',
    aldri_hentet: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  }
  const tekst: Record<KildeStatus['status'], string> = {
    ok: 'Hentet',
    feilet: 'Feilet',
    aldri_hentet: 'Aldri hentet',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${stiler[status]}`}>
      {tekst[status]}
    </span>
  )
}

export default function KilderPanel({
  nokkel,
  onAvvist,
}: {
  nokkel: string
  onAvvist: () => void
}) {
  // Adminnøkkelen sendes som Bearer på hvert kall. Den ligger bare i
  // sessionStorage hos den som er logget på, aldri i en URL og aldri i en
  // cookie, slik at den ikke følger med på en delt lenke ved et uhell.
  const auth = { Authorization: `Bearer ${nokkel}` }

  const [kilder, setKilder] = useState<KildeStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [kjorer, setKjorer] = useState<string | null>(null) // 'alle' eller en kilde-id
  const [resultat, setResultat] = useState<string | null>(null)

  // Rører ingen tilstand før første await. `loading` starter som true, og
  // omlastinger etter en henting har allerede sin egen spinner i `kjorer`, så
  // ingenting blinker av at vi lar være å sette den på nytt her.
  async function last() {
    try {
      const resp = await fetch('/api/admin/ssb/kilder', { headers: auth })
      if (resp.status === 401) return onAvvist()
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Ukjent feil')
      setKilder(Array.isArray(data.kilder) ? data.kilder : [])
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // `last()` setter ingen tilstand før den første `await`-en, så den utløser
  // ikke den kaskaderenderingen regelen er laget for å fange. Regelen kan ikke
  // se forskjell på det og et synkront kall, derfor slås den av her og bare
  // her — ikke i konfigurasjonen, hvor den ville skjult ekte tilfeller.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void last()
  }, [nokkel])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function hentAlle() {
    setKjorer('alle')
    setResultat(null)
    try {
      const resp = await fetch('/api/admin/ssb/kilder/refresh', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (resp.status === 401) return onAvvist()
      const data = await resp.json()
      if (resp.ok && data.ok) {
        setResultat(
          Array.isArray(data.forsokt) && data.forsokt.length
            ? `Hentet ${data.forsokt.length} usynkronisert${data.forsokt.length !== 1 ? 'e' : ''} kilde${data.forsokt.length !== 1 ? 'r' : ''}.`
            : 'Alt var allerede synkronisert — ingenting å hente.'
        )
      } else {
        setResultat(`Feil: ${data.error ?? 'Ukjent feil'}`)
      }
      await last()
    } catch {
      setResultat('Nettverksfeil.')
    } finally {
      setKjorer(null)
    }
  }

  async function tvingEn(id: string) {
    setKjorer(id)
    setResultat(null)
    try {
      const resp = await fetch('/api/admin/ssb/kilder/refresh', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kildeId: id }),
      })
      if (resp.status === 401) return onAvvist()
      const data = await resp.json()
      if (!resp.ok || !data.ok) setResultat(`Feil: ${data.error ?? 'Ukjent feil'}`)
      await last()
    } catch {
      setResultat('Nettverksfeil.')
    } finally {
      setKjorer(null)
    }
  }

  async function settFlagg(id: string, tvungen: boolean) {
    setKilder((forrige) => forrige.map((k) => (k.id === id ? { ...k, tvungenOppdatering: tvungen } : k)))
    try {
      const resp = await fetch('/api/admin/ssb/kilder/flagg', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kildeId: id, tvungen }),
      })
      if (!resp.ok) throw new Error()
    } catch {
      // Rull tilbake ved feil, i stedet for å late som boksen ble endret.
      setKilder((forrige) => forrige.map((k) => (k.id === id ? { ...k, tvungenOppdatering: !tvungen } : k)))
    }
  }

  const temaer = [...new Set(kilder.map((k) => k.tema))]

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Kommunedata (Finnmarkspanelet)</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Datakilder til Finnmarkspanelet, gruppert per tema. «Hent alle nå» henter bare kilder som mangler,
            sist feilet, eller er avmerket for tvungen oppdatering — ikke alt på nytt hver gang.
          </p>
        </div>
        <button
          onClick={hentAlle}
          disabled={kjorer !== null}
          className="px-4 py-2 border border-zinc-300 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
        >
          {kjorer === 'alle' ? (
            <>
              <Spinner /> Henter...
            </>
          ) : (
            '▶ Hent alle nå'
          )}
        </button>
      </div>

      {resultat && <p className="text-sm text-zinc-500">{resultat}</p>}

      <section className="space-y-6">
        {loading ? (
          <div className="text-sm text-zinc-400">Laster status...</div>
        ) : loadError ? (
          <div className="text-sm text-red-600">{loadError}</div>
        ) : (
          temaer.map((tema) => (
            <div key={tema}>
              <h2 className="text-sm font-semibold text-zinc-700 mb-2">{TEMA_NAVN[tema] ?? tema}</h2>
              <div className="space-y-2">
                {kilder
                  .filter((k) => k.tema === tema)
                  .map((k) => (
                    <div key={k.id} className="bg-white border border-zinc-200 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900">{k.navn}</span>
                            <StatusBadge status={k.status} />
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {k.hentet ? (
                              <>
                                Sist hentet {relativeTime(k.hentet)} · {k.antallRader} rader · {k.kilde}
                              </>
                            ) : (
                              <>Aldri hentet · {k.kilde}</>
                            )}
                            {k.feil && <span className="text-amber-700"> · siste forsøk feilet: {k.feil}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={k.tvungenOppdatering}
                              onChange={(e) => settFlagg(k.id, e.target.checked)}
                              className="rounded border-zinc-300"
                            />
                            Oppdater ved neste kjøring
                          </label>
                          <button
                            onClick={() => tvingEn(k.id)}
                            disabled={kjorer !== null}
                            className="px-3 py-1.5 border border-zinc-300 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                          >
                            {kjorer === k.id ? (
                              <>
                                <Spinner /> Henter...
                              </>
                            ) : (
                              'Tving nå'
                            )}
                          </button>
                        </div>
                      </div>

                      {k.advarsler.length > 0 && (
                        <details className="mt-3">
                          <summary className="text-xs text-amber-700 cursor-pointer select-none">
                            {k.advarsler.length} advarsel{k.advarsler.length !== 1 ? 'er' : ''} fra siste henting
                          </summary>
                          <ul className="mt-2 space-y-1 text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {k.advarsler.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))
        )}
      </section>
    </>
  )
}
