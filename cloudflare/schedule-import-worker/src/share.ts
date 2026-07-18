const SHARE_PATH = /^\/share\/([^/]+)(\/image\.png)?$/i
const SHARE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WIDTH = 1200
const HEIGHT = 630

export interface ShareEnv {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
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
  if (!Number.isInteger(row.period_number) || Number(row.period_number) < 1 || Number(row.period_number) > 8) return null
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

function pageHtml(url: URL, share: PublicScheduleShare): string {
  const canonicalUrl = `${url.origin}${url.pathname}`
  const imageUrl = `${canonicalUrl}/image.png`
  const title = share.available
    ? 'A/B-Day Schedule | NA ScheduleShare'
    : 'Schedule unavailable | NA ScheduleShare'
  const description = share.available
    ? 'A shared A/B-day class schedule with periods and course names.'
    : 'This shared schedule is private, disabled, or no longer available.'
  const scheduleRows = share.schedule.map((row) => (
    `<li><strong>${row.day_type} Day · Period ${row.period_number}</strong><span>${escapeHtml(row.course_name)}</span></li>`
  )).join('')
  const body = share.available
    ? `<h1>A/B-Day Schedule</h1><p>Shared with NA ScheduleShare</p><ul>${scheduleRows}</ul>`
    : '<h1>This schedule isn’t available</h1><p>It may be private, disabled, or the link may be invalid.</p>'

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
<style>body{margin:0;background:#f7f0dd;color:#172235;font:16px system-ui,sans-serif}main{max-width:760px;margin:64px auto;padding:32px;background:#fff;border-top:8px solid #f2b928;box-shadow:0 12px 36px #1722351f}h1{margin-top:0}ul{display:grid;gap:10px;padding:0;list-style:none}li{display:flex;justify-content:space-between;gap:24px;padding:12px;border:1px solid #d9d2c2}footer{max-width:760px;margin:auto;padding:0 32px 48px;color:#5d6573}</style>
</head><body><main>${body}</main><footer>NA ScheduleShare · Built by the NA Computer and AI Club · Not an official school website.</footer></body></html>`
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
    return new Response(request.method === 'HEAD' ? null : renderPreviewPng(share).buffer, { status, headers })
  }

  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(request.method === 'HEAD' ? null : pageHtml(url, share), { status, headers })
}

const FONT: Record<string, string[]> = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  A: ['01110','10001','10001','11111','10001','10001','10001'], B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'], D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'], F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'], H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'], J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'], L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'], N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'], P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'], R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'], T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'], V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'], X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'], Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'], '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '&': ['01100','10010','10100','01000','10101','10010','01101'], '.': ['00000','00000','00000','00000','00000','01100','01100'],
  ':': ['00000','01100','01100','00000','01100','01100','00000'], '+': ['00000','00100','00100','11111','00100','00100','00000'],
  "'": ['01100','01100','00100','00000','00000','00000','00000'], '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000'],
}

const PALETTE = new Uint8Array([
  247,240,221, 23,34,53, 242,185,40, 255,255,255,
  93,101,115, 217,210,194, 181,121,0,
])

function concatBytes(parts: ReadonlyArray<Uint8Array<ArrayBufferLike>>): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const typeBytes = new TextEncoder().encode(type)
  const content = concatBytes([typeBytes, data])
  return concatBytes([uint32(data.length), content, uint32(crc32(content))])
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}

function storeDeflate(data: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array<ArrayBufferLike>[] = [new Uint8Array([0x78, 0x01])]
  for (let offset = 0; offset < data.length; offset += 65535) {
    const length = Math.min(65535, data.length - offset)
    const final = offset + length >= data.length ? 1 : 0
    parts.push(new Uint8Array([final, length & 255, (length >>> 8) & 255, (~length) & 255, ((~length) >>> 8) & 255]))
    parts.push(data.subarray(offset, offset + length))
  }
  parts.push(uint32(adler32(data)))
  return concatBytes(parts)
}

function drawRect(pixels: Uint8Array, x: number, y: number, width: number, height: number, color: number): void {
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  const right = Math.min(WIDTH, x + width)
  const bottom = Math.min(HEIGHT, y + height)
  for (let row = top; row < bottom; row += 1) pixels.fill(color, row * WIDTH + left, row * WIDTH + right)
}

function drawText(pixels: Uint8Array, value: string, x: number, y: number, scale: number, color: number): void {
  let cursor = x
  for (const character of value.toLocaleUpperCase()) {
    const glyph = FONT[character] ?? FONT[' ']
    glyph.forEach((line, row) => {
      for (let column = 0; column < line.length; column += 1) {
        if (line[column] === '1') drawRect(pixels, cursor + column * scale, y + row * scale, scale, scale, color)
      }
    })
    cursor += 6 * scale
  }
}

function periodLabel(rows: PublicScheduleRow[], day: 'A' | 'B', period: number): string {
  const matches = rows.filter((row) => row.day_type === day && row.period_number === period)
  if (matches.length === 0) return 'OPEN'
  const names = [...new Set(matches.map((row) => row.course_name))]
  const value = names.join(' / ').toLocaleUpperCase()
  return value.length > 25 ? `${value.slice(0, 22)}...` : value
}

export function renderPreviewPng(share: PublicScheduleShare): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(WIDTH * HEIGHT)
  pixels.fill(0)
  drawRect(pixels, 0, 0, WIDTH, 116, 1)
  drawRect(pixels, 0, 108, WIDTH, 8, 2)
  drawText(pixels, 'NA SCHEDULESHARE', 48, 28, 6, 3)
  drawText(pixels, share.available ? 'A/B-DAY CLASS SCHEDULE' : 'SCHEDULE UNAVAILABLE', 48, 80, 3, 2)

  if (share.available) {
    for (const [column, day] of (['A', 'B'] as const).entries()) {
      const x = column === 0 ? 48 : 624
      drawRect(pixels, x, 140, 528, 42, 2)
      drawText(pixels, `${day} DAY`, x + 18, 150, 3, 1)
      for (let period = 1; period <= 8; period += 1) {
        const y = 190 + (period - 1) * 48
        drawRect(pixels, x, y, 528, 42, 3)
        drawRect(pixels, x, y, 54, 42, 1)
        drawText(pixels, String(period), x + 20, y + 10, 3, 3)
        drawText(pixels, periodLabel(share.schedule, day, period), x + 72, y + 11, 3, 1)
      }
    }
  } else {
    drawRect(pixels, 130, 190, 940, 250, 3)
    drawRect(pixels, 130, 190, 12, 250, 2)
    drawText(pixels, 'THIS SCHEDULE IS PRIVATE,', 190, 250, 5, 1)
    drawText(pixels, 'DISABLED, OR UNAVAILABLE.', 190, 310, 5, 1)
    drawText(pixels, 'NO SCHEDULE DATA IS SHOWN.', 190, 385, 3, 4)
  }
  drawText(pixels, 'BUILT BY THE NA COMPUTER AND AI CLUB', 48, 598, 3, 4)

  const scanlines = new Uint8Array((WIDTH + 1) * HEIGHT)
  for (let y = 0; y < HEIGHT; y += 1) scanlines.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1)
  const ihdr = concatBytes([uint32(WIDTH), uint32(HEIGHT), new Uint8Array([8, 3, 0, 0, 0])])
  return concatBytes([
    new Uint8Array([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', PALETTE),
    pngChunk('IDAT', storeDeflate(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
}
