import { Resvg } from '@cf-wasm/resvg/workerd'
import interSemibold from '@fontsource/inter/files/inter-latin-600-normal.woff2'
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2'
import { readBoundedJson } from './http'

const SHARE_PATH = /^\/share\/([^/]{1,128})(\/image\.png)?$/i
const SHARE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WIDTH = 1200
const HEIGHT = 630
const MAX_PUBLIC_SCHEDULE_ROWS = 54
const MAX_SHARE_RESPONSE_BYTES = 128 * 1024
const SUPABASE_TIMEOUT_MS = 10_000
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

function configuredSiteUrl(env: ShareEnv): string {
  const candidate = env.SITE_URL?.trim() || DEFAULT_SITE_URL
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username || url.password || url.search || url.hash) return DEFAULT_SITE_URL.replace(/\/$/, '')
    return url.href.replace(/\/$/, '')
  } catch {
    return DEFAULT_SITE_URL.replace(/\/$/, '')
  }
}

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
  if (typeof row.course_name !== 'string' || row.course_name.length > 120 || row.course_name.trim().length === 0) return null
  const academicTerm = row.academic_term
  if (academicTerm !== 'full_year' && academicTerm !== 'semester_1' && academicTerm !== 'semester_2') return null
  return {
    day_type: row.day_type,
    period_number: Number(row.period_number),
    course_name: row.course_name.trim(),
    academic_term: academicTerm,
  }
}

async function fetchPublicSchedule(token: string, env: ShareEnv, requestId?: string): Promise<PublicScheduleShare> {
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
      redirect: 'manual',
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'public_schedule_fetch_failed', request_id: requestId, status: response.status }))
      return genericShare
    }
    const value = await readBoundedJson(response, MAX_SHARE_RESPONSE_BYTES)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return genericShare
    const result = value as Record<string, unknown>
    if (result.available !== true || !Array.isArray(result.schedule)
      || result.schedule.length < 1 || result.schedule.length > MAX_PUBLIC_SCHEDULE_ROWS) return genericShare
    const schedule = result.schedule.map(safeRow).filter((row): row is PublicScheduleRow => row !== null)
    if (schedule.length !== result.schedule.length) return genericShare
    return { available: true, schedule }
  } catch (error) {
    console.error(JSON.stringify({
      event: 'public_schedule_fetch_failed',
      request_id: requestId,
      error_name: error instanceof Error ? error.name : 'UnknownError',
    }))
    return genericShare
  }
}

function pageHtml(url: URL, token: string, share: PublicScheduleShare, env: ShareEnv, nonce: string): string {
  const canonicalUrl = `${url.origin}${url.pathname}`
  const imageUrl = `${canonicalUrl}/image.png`
  const siteUrl = configuredSiteUrl(env)
  const reactUrl = `${siteUrl}/#/share/${encodeURIComponent(token)}`
  const title = share.available
    ? 'My Schedule | NA ScheduleShare'
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
<script nonce="${nonce}">window.location.replace(${JSON.stringify(reactUrl)})</script>
</head><body><p>Opening ScheduleShare… <a href="${escapeHtml(reactUrl)}">Continue to the shared schedule</a>.</p></body></html>`
}

export async function handleShareRequest(request: Request, env: ShareEnv): Promise<Response | null> {
  const url = new URL(request.url)
  const match = url.pathname.match(SHARE_PATH)
  if (!match) return null
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD')
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    return new Response('Method not allowed', { status: 405, headers })
  }

  const token = match[1].toLowerCase()
  const cfRay = request.headers.get('CF-Ray')
  const requestId = cfRay && /^[a-z0-9-]{1,100}$/i.test(cfRay) ? cfRay : undefined
  const share = SHARE_TOKEN.test(token) ? await fetchPublicSchedule(token, env, requestId) : genericShare
  const status = share.available ? 200 : 404
  if (match[2]) {
    headers.set('Content-Type', 'image/png')
    const png = request.method === 'HEAD' ? null : await renderPreviewPng(share)
    return new Response(png, { status, headers })
  }

  headers.set('Content-Type', 'text/html; charset=utf-8')
  const nonce = crypto.randomUUID().replace(/-/g, '')
  headers.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
  return new Response(request.method === 'HEAD' ? null : pageHtml(url, token, share, env, nonce), { status, headers })
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

// Colors mirror the web app's design tokens (src/styles/tokens.css).
const PAPER = '#ffffff'
const CHALK = '#f4f4f1'
const INK = '#17191c'
const SLATE = '#5d6066'
const LINE = '#e4e4e0'
const GOLD = '#faaa13'
const ROW_TOP = 170
const ROW_STEP = 44
const COLUMN_WIDTH = 528

// The NA Computer and AI Club mark on its native 1200-unit grid.
const MARK_TOP = 'M0 0H200L400 200V0H600V200L800 0H1200V600H1000V400H800V600H400L200 400V600H0Z M900 150H1000V250H800Z'
const MARK_BOTTOM = 'M200 600H600V800H300L200 900L300 1000H600V1200H200L0 1000V800Z M800 600H1200V800H900L800 900L900 1000H1200V1200H800L600 1000V800Z'

function previewSvg(share: PublicScheduleShare): string {
  const columns = share.available
    ? (['A', 'B'] as const).map((day, column) => {
      const x = column === 0 ? 48 : 624
      const rows = Array.from({ length: 9 }, (_, index) => {
        const period = index + 1
        const y = ROW_TOP + index * ROW_STEP
        const rawLabel = previewPeriodLabel(share.schedule, day, period)
        const label = escapeHtml(rawLabel)
        const open = rawLabel === 'Open'
        return `
          <rect x="${x}" y="${y}" width="40" height="38" rx="6" fill="${CHALK}"/>
          <text x="${x + 20}" y="${y + 26}" text-anchor="middle" font-size="20" font-weight="700" fill="${INK}">${period}</text>
          <text x="${x + 56}" y="${y + 26}" clip-path="url(#course-${day}-${period})" font-size="${COURSE_FONT_SIZE}" font-weight="600" fill="${open ? SLATE : INK}">${label}</text>
          ${index < 8 ? `<rect x="${x + 56}" y="${y + 41}" width="${COLUMN_WIDTH - 56}" height="1" fill="${LINE}"/>` : ''}`
      }).join('')
      return `
        <text x="${x}" y="152" font-size="22" font-weight="700" fill="${INK}">${day} day</text>${rows}`
    }).join('')
    : `
      <rect x="130" y="200" width="6" height="200" rx="3" fill="${GOLD}"/>
      <text x="166" y="268" font-size="42" font-weight="700" fill="${INK}">This link is invalid, disabled,</text>
      <text x="166" y="320" font-size="42" font-weight="700" fill="${INK}">or unavailable.</text>
      <text x="166" y="378" font-size="25" font-weight="600" fill="${SLATE}">No schedule data is shown.</text>`

  const clipPaths = Array.from({ length: 18 }, (_, index) => {
    const day = index < 9 ? 'A' : 'B'
    const period = (index % 9) + 1
    const x = (day === 'A' ? 48 : 624) + 56
    const y = ROW_TOP + (period - 1) * ROW_STEP
    return `<clipPath id="course-${day}-${period}"><rect x="${x}" y="${y}" width="${COURSE_TEXT_WIDTH}" height="38"/></clipPath>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>${clipPaths}</defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
    <g transform="translate(48 36) scale(0.04)">
      <path d="${MARK_TOP}" fill="${GOLD}" fill-rule="evenodd"/>
      <path d="${MARK_BOTTOM}" fill="#000000"/>
    </g>
    <rect x="48" y="104" width="${WIDTH - 96}" height="1" fill="${LINE}"/>
    <g font-family="Inter, sans-serif">
      <text x="110" y="74" font-size="32" font-weight="700" fill="${INK}" letter-spacing="-0.6">NA ScheduleShare</text>
      <text x="${WIDTH - 48}" y="74" text-anchor="end" font-size="22" font-weight="600" fill="${SLATE}">${share.available ? 'Shared schedule' : ''}</text>
      ${columns}
      <text x="48" y="604" font-size="20" font-weight="600" fill="${SLATE}">Built by the NA Computer and AI Club</text>
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
  try {
    const image = renderer.render()
    try {
      return image.asPng().slice()
    } finally {
      image.free()
    }
  } finally {
    renderer.free()
  }
}
