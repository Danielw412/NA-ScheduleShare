import { Resvg } from '@cf-wasm/resvg/workerd'
import interSemibold from '@fontsource/inter/files/inter-latin-600-normal.woff2'
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2'

const SHARE_PATH = /^\/share\/([^/]+)(\/image\.png)?$/i
const SHARE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WIDTH = 1200
const HEIGHT = 630
const DEFAULT_SITE_URL = 'https://danielw412.github.io/NA-ScheduleShare/'

export interface ShareEnv {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SITE_URL?: string
}

export interface PublicScheduleRow {
  day_type: 'A' | 'B'
  period_number: number
  course_name: string
  academic_term: 'full_year' | 'semester_1' | 'semester_2'
}

interface PublicScheduleShare {
  available: boolean
  schedule: PublicScheduleRow[]
}

const genericShare: PublicScheduleShare = { available: false, schedule: [] }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function safeRow(value: unknown): PublicScheduleRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.day_type !== 'A' && row.day_type !== 'B') return null
  if (!Number.isInteger(row.period_number) || Number(row.period_number) < 1 || Number(row.period_number) > 9) return null
  if (typeof row.course_name !== 'string' || row.course_name.trim().length === 0) return null
  if (!['full_year', 'semester_1', 'semester_2'].includes(String(row.academic_term))) return null
  return {
    day_type: row.day_type,
    period_number: Number(row.period_number),
    course_name: row.course_name.trim().slice(0, 120),
    academic_term: row.academic_term as PublicScheduleRow['academic_term'],
  }
}

async function fetchPublicSchedule(token: string, env: ShareEnv): Promise<PublicScheduleShare> {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '')
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!supabaseUrl || !publishableKey) return genericShare

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_schedule_share`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    })
    if (!response.ok) return genericShare
    const value: unknown = await response.json()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return genericShare
    const result = value as Record<string, unknown>
    if (result.available !== true || !Array.isArray(result.schedule)) return genericShare
    return { available: true, schedule: result.schedule.map(safeRow).filter((row): row is PublicScheduleRow => row !== null) }
  } catch {
    return genericShare
  }
}

function pageHtml(url: URL, token: string, share: PublicScheduleShare, env: ShareEnv): string {
  const canonicalUrl = `${url.origin}${url.pathname}`
  const imageUrl = `${canonicalUrl}/image.png`
  const siteUrl = (env.SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/$/, '')
  const reactUrl = `${siteUrl}/#/share/${encodeURIComponent(token)}`
  const title = share.available
    ? 'A/B-Day Schedule | NA ScheduleShare'
    : 'Schedule unavailable | NA ScheduleShare'
  const description = share.available
    ? 'A shared A/B-day class schedule with periods and course names.'
    : 'This shared schedule link is invalid, disabled, or no longer available.'
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<script>window.location.replace(${JSON.stringify(reactUrl)})</script>
</head><body><p>Opening ScheduleShare… <a href="${escapeHtml(reactUrl)}">Continue to the shared schedule</a>.</p></body></html>`
}

export async function handleShareRequest(request: Request, env: ShareEnv): Promise<Response | null> {
  const url = new URL(request.url)
  const match = url.pathname.match(SHARE_PATH)
  if (!match) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const token = match[1].toLowerCase()
  const share = SHARE_TOKEN.test(token) ? await fetchPublicSchedule(token, env) : genericShare
  const status = share.available ? 200 : 404
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })

  if (match[2]) {
    headers.set('Content-Type', 'image/png')
    const png = request.method === 'HEAD' ? null : await renderPreviewPng(share)
    return new Response(png, { status, headers })
  }

  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(request.method === 'HEAD' ? null : pageHtml(url, token, share, env), { status, headers })
}

const COURSE_FONT_SIZE = 20
const COURSE_TEXT_WIDTH = 420

function estimatedCharacterWidth(character: string, fontSize: number): number {
  if (/\s/.test(character)) return fontSize * 0.3
  if (/[ilI1.,'|!]/.test(character)) return fontSize * 0.3
  if (/[mwMW@%&]/.test(character)) return fontSize * 0.9
  if (/[A-Z0-9]/.test(character)) return fontSize * 0.65
  return fontSize * 0.55
}

function truncateToWidth(value: string, maxWidth: number, fontSize: number): string {
  const characters = [...value]
  const fullWidth = characters.reduce((width, character) => width + estimatedCharacterWidth(character, fontSize), 0)
  if (fullWidth <= maxWidth) return value

  const ellipsis = '…'
  const ellipsisWidth = estimatedCharacterWidth(ellipsis, fontSize)
  let width = 0
  let result = ''
  for (const character of characters) {
    const characterWidth = estimatedCharacterWidth(character, fontSize)
    if (width + characterWidth + ellipsisWidth > maxWidth) break
    result += character
    width += characterWidth
  }
  return `${result.trimEnd()}${ellipsis}`
}

export function previewPeriodLabel(rows: PublicScheduleRow[], day: 'A' | 'B', period: number): string {
  const matches = rows.filter((row) => (
    row.day_type === day
    && row.period_number === period
    && row.academic_term !== 'semester_2'
  ))
  if (matches.length === 0) return 'Open'
  const names = [...new Set(matches.map((row) => row.course_name))]
  return truncateToWidth(names.join(' / '), COURSE_TEXT_WIDTH, COURSE_FONT_SIZE)
}

function previewSvg(share: PublicScheduleShare): string {
  const columns = share.available
    ? (['A', 'B'] as const).map((day, column) => {
      const x = column === 0 ? 48 : 624
      const rows = Array.from({ length: 9 }, (_, index) => {
        const period = index + 1
        const y = 154 + index * 46
        const label = escapeHtml(previewPeriodLabel(share.schedule, day, period))
        return `
          <rect x="${x}" y="${y}" width="528" height="40" rx="4" fill="#fff"/>
          <path d="M${x + 4} ${y}h50v40h-50a4 4 0 0 1-4-4v-32a4 4 0 0 1 4-4z" fill="#000"/>
          <text x="${x + 27}" y="${y + 27}" text-anchor="middle" font-size="20" font-weight="700" fill="#fff">${period}</text>
          <text x="${x + 72}" y="${y + 27}" clip-path="url(#course-${day}-${period})" font-size="${COURSE_FONT_SIZE}" font-weight="600" fill="#000">${label}</text>`
      }).join('')
      return `
        <rect x="${x}" y="106" width="528" height="40" rx="4" fill="#f2b928"/>
        <text x="${x + 18}" y="134" font-size="22" font-weight="700" fill="#000">${day} Day</text>${rows}`
    }).join('')
    : `
      <rect x="130" y="190" width="940" height="250" rx="8" fill="#fff"/>
      <path d="M138 190h4v250h-4a8 8 0 0 1-8-8v-234a8 8 0 0 1 8-8z" fill="#f2b928"/>
      <text x="190" y="278" font-size="42" font-weight="700" fill="#000">This link is invalid, disabled,</text>
      <text x="190" y="330" font-size="42" font-weight="700" fill="#000">or unavailable.</text>
      <text x="190" y="392" font-size="25" font-weight="600" fill="#5d6573">No schedule data is shown.</text>`

  const clipPaths = Array.from({ length: 18 }, (_, index) => {
    const day = index < 9 ? 'A' : 'B'
    const period = (index % 9) + 1
    const x = day === 'A' ? 120 : 696
    const y = 154 + (period - 1) * 46
    return `<clipPath id="course-${day}-${period}"><rect x="${x}" y="${y}" width="${COURSE_TEXT_WIDTH}" height="40"/></clipPath>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>${clipPaths}</defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f0dd"/>
    <rect width="${WIDTH}" height="92" fill="#000"/>
    <rect y="84" width="${WIDTH}" height="8" fill="#f2b928"/>
    <g font-family="Inter, sans-serif">
      <text x="48" y="62" font-size="46" font-weight="700" fill="#fff">NA ScheduleShare</text>
      ${columns}
      <text x="48" y="612" font-size="26" font-weight="600" fill="#5d6573">Built by the NA Computer and AI Club</text>
    </g>
  </svg>`
}

export async function renderPreviewPng(share: PublicScheduleShare): Promise<Uint8Array<ArrayBuffer>> {
  const renderer = await Resvg.async(previewSvg(share), {
    font: {
      fontBuffers: [new Uint8Array(interSemibold), new Uint8Array(interBold)],
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
    },
    shapeRendering: 2,
    textRendering: 2,
  })
  const image = renderer.render()
  const png = image.asPng().slice()
  image.free()
  renderer.free()
  return png
}
