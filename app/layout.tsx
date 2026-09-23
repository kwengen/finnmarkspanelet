import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'Finnmarkspanelet',
  description: 'Offentlig statistikk om Finnmark, hentet fra SSBs åpne API.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className={`${geist.variable} h-full`}>
      <body className="h-full bg-zinc-50 font-sans antialiased">{children}</body>
    </html>
  )
}
