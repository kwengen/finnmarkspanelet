const PRODUCTION_SITE_URL = 'https://finnmarkspanelet.vercel.app'

const LOCAL_SITE_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!configured || LOCAL_SITE_URL.test(configured)) return PRODUCTION_SITE_URL
  return configured.replace(/\/+$/, '')
}
