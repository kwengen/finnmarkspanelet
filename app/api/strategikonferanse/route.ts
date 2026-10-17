import { NextResponse } from 'next/server'
import { getCurrentIdentity } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SOURCE_ID = 'refleksjonsverktoy'

type StrategyResponseRow = {
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

    const service = await createServiceClient()
    const { data, error } = await service
      .from('strategy_responses')
      .select('id, row_number, author, local_lag, question, response_text, submitted_at')
      .eq('source', SOURCE_ID)
      .order('row_number', { ascending: true })

    if (error) throw error

    const rows = (data ?? []) as StrategyResponseRow[]
    const questions = [...new Set(rows
      .map((row) => row.question)
      .filter((question): question is string => typeof question === 'string' && question.length > 0))]

    return NextResponse.json({
      sources: [{
        id: SOURCE_ID,
        title: 'Refleksjonsverktøy – strategisamling 2026',
        questions,
      }],
      responses: rows.map((row) => ({
        id: `refleksjonsverktoy-${row.row_number}`,
        source: SOURCE_ID,
        page: null,
        text: row.response_text,
        question: row.question,
        author: row.author,
        localLag: row.local_lag,
        submittedAt: row.submitted_at,
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Kunne ikke hente strategikonferansesvar', error)
    return NextResponse.json({ error: 'Kunne ikke hente strategikonferansesvar.' }, { status: 500 })
  }
}
