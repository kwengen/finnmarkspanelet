import { NextResponse } from 'next/server'
import { getCurrentIdentity } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SOURCE_ID = 'refleksjonsverktoy'
const SOURCE_TITLE = 'Refleksjonsverktøy – strategisamling 2026'

type StrategyResponseRow = {
  id: string
  source: string
  row_number: number
  author: string
  local_lag: string | null
  question: string
  response_text: string
  submitted_at: string
}

export async function GET() {
  try {
    if (!await getCurrentIdentity()) {
      return NextResponse.json({ error: 'Innlogging kreves.' }, { status: 401 })
    }
  } catch (error) {
    console.error('Autentisering feilet', error)
    return NextResponse.json({ error: 'Autentisering er ikke konfigurert.' }, { status: 503 })
  }

  try {
    const service = await createServiceClient()
    const { data, error } = await service
      .from('strategy_responses')
      .select('id, source, row_number, author, local_lag, question, response_text, submitted_at')
      .eq('source', SOURCE_ID)
      .order('row_number', { ascending: true })

    if (error) {
      console.error('Kunne ikke lese strategikonferanse-oppføringer', error)
      return NextResponse.json({ error: 'Kunne ikke hente strategikonferanse-oppføringene.' }, { status: 500 })
    }

    const rows = (data ?? []) as StrategyResponseRow[]
    const questions = [...new Set(rows.map(row => row.question).filter(Boolean))]

    return NextResponse.json(
      {
        sources: [{ id: SOURCE_ID, title: SOURCE_TITLE, questions }],
        responses: rows.map(row => ({
          id: row.id,
          source: row.source,
          row: row.row_number,
          author: row.author,
          localLag: row.local_lag,
          question: row.question,
          text: row.response_text,
          submittedAt: row.submitted_at,
        })),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    console.error('Kunne ikke hente strategikonferansesvar', error)
    return NextResponse.json({ error: 'Kunne ikke hente strategikonferansesvar.' }, { status: 500 })
  }
}
