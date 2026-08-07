import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleShareRequest, previewPeriodLabel, type ShareEnv } from '../src/share'

const TOKEN = '99300000-0000-4000-8000-000000000001'
const env: ShareEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SITE_URL: 'https://app.example/NA-ScheduleShare/',
}

afterEach(() => vi.restoreAllMocks())

function mockShare(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)))
}

function expectValidPreviewPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  expect(bytes.byteLength).toBeGreaterThan(0)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe('IHDR')
  expect(view.getUint32(16)).toBe(1200)
  expect(view.getUint32(20)).toBe(630)
  expect(new TextDecoder().decode(bytes.subarray(-8, -4))).toBe('IEND')
}

describe('schedule share HTML', () => {
  it('returns raw Open Graph and Twitter metadata in the initial response', async () => {
    mockShare({
      available: true,
      schedule: [{ day_type: 'A', period_number: 2, course_name: 'Biology <script>', academic_term: 'full_year' }],
      email: 'student@example.com',
      owner_id: 'private-user-id',
    })
    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), env)
    const html = await response?.text()

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Content-Type')).toContain('text/html')
    expect(response?.headers.get('Cache-Control')).toBe('no-store')
    const contentSecurityPolicy = response?.headers.get('Content-Security-Policy') ?? ''
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'")
    expect(contentSecurityPolicy).not.toContain("'unsafe-inline'")
    const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(html).toContain(`<script nonce="${nonce}">`)
    expect(response?.headers.get('Permissions-Policy')).toContain('camera=()')
    expect(response?.headers.get('X-Frame-Options')).toBe('DENY')
    expect(html).toContain('<title>Schedule | NA ScheduleShare</title>')
    expect(html).toContain('<meta property="og:title" content="Schedule | NA ScheduleShare">')
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain(`<meta property="og:url" content="https://share.example/share/${TOKEN}">`)
    expect(html).toContain(`<meta property="og:image" content="https://share.example/share/${TOKEN}/image.png">`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain(`window.location.replace("https://app.example/NA-ScheduleShare/#/share/${TOKEN}")`)
    expect(html).toContain(`href="https://app.example/NA-ScheduleShare/#/share/${TOKEN}"`)
    expect(html).not.toContain('student@example.com')
    expect(html).not.toContain('private-user-id')
    expect(html).not.toContain('Biology')
    expect(html).not.toContain('<ul>')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/get_public_schedule_share',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
    )
  })

  it('returns the same safe generic page for private, disabled, and invalid links', async () => {
    mockShare({ available: false, schedule: [] })
    const privateResponse = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), env)
    const invalidResponse = await handleShareRequest(new Request('https://share.example/share/not-a-token'), env)
    const privateHtml = await privateResponse?.text()
    const invalidHtml = await invalidResponse?.text()

    expect(privateResponse?.status).toBe(404)
    expect(invalidResponse?.status).toBe(404)
    expect(privateHtml).toContain(`/#/share/${TOKEN}`)
    expect(invalidHtml).toContain('/#/share/not-a-token')
    expect(privateHtml).toContain('Schedule unavailable | NA ScheduleShare')
    expect(invalidHtml).toContain('Schedule unavailable | NA ScheduleShare')
    expect(privateHtml).not.toContain('course_name')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('falls back to the known site URL when SITE_URL is not HTTP or HTTPS', async () => {
    mockShare({ available: false, schedule: [] })
    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), {
      ...env,
      SITE_URL: 'javascript:alert(1)',
    })
    const html = await response?.text()

    expect(html).toContain(`https://danielw412.github.io/NA-ScheduleShare/#/share/${TOKEN}`)
    expect(html).not.toContain('javascript:')
  })

  it('fails closed instead of returning a partial schedule when an upstream row is malformed', async () => {
    mockShare({
      available: true,
      schedule: [
        { day_type: 'A', period_number: 1, course_name: 'Biology', academic_term: 'full_year' },
        { day_type: 'invalid', period_number: 2, course_name: 'English', academic_term: 'full_year' },
      ],
    })

    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), env)
    const html = await response?.text()

    expect(response?.status).toBe(404)
    expect(html).toContain('Schedule unavailable | NA ScheduleShare')
    expect(html).not.toContain('Biology')
  })

  it('rejects unexpectedly large share payloads before using them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      headers: { 'Content-Length': String(128 * 1024 + 1) },
    })))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), env)

    expect(response?.status).toBe(404)
    expect(await response?.text()).toContain('Schedule unavailable | NA ScheduleShare')
  })
})

describe('schedule preview image', () => {
  it('returns a public 1200 × 630 PNG for a visible schedule', async () => {
    mockShare({
      available: true,
      schedule: [
        { day_type: 'A', period_number: 1, course_name: 'AP Statistics', academic_term: 'full_year' },
        { day_type: 'B', period_number: 3, course_name: 'English 11', academic_term: 'full_year' },
        { day_type: 'A', period_number: 9, course_name: 'Robotics', academic_term: 'semester_1' },
      ],
    })
    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}/image.png`), env)
    const bytes = new Uint8Array(await response!.arrayBuffer())

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Content-Type')).toBe('image/png')
    expectValidPreviewPng(bytes)
  })

  it('returns a 404 PNG for an unavailable schedule', async () => {
    mockShare({ available: false, schedule: [] })
    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}/image.png`), env)
    const bytes = new Uint8Array(await response!.arrayBuffer())

    expect(response?.status).toBe(404)
    expect(response?.headers.get('Content-Type')).toBe('image/png')
    expectValidPreviewPng(bytes)
  })

  it('renders the first-semester course for period 9 and excludes semester 2', () => {
    const rows = [
      { day_type: 'A' as const, period_number: 9, course_name: 'Robotics', academic_term: 'semester_1' as const },
      { day_type: 'A' as const, period_number: 9, course_name: 'Calculus', academic_term: 'semester_2' as const },
    ]

    expect(previewPeriodLabel(rows, 'A', 9)).toBe('Robotics')
  })

  it('truncates long course names with an ellipsis', () => {
    const courseName = 'Introduction to Artificial Intelligence and Machine Learning'
    const rows = [
      { day_type: 'A' as const, period_number: 2, course_name: courseName, academic_term: 'full_year' as const },
    ]
    const label = previewPeriodLabel(rows, 'A', 2)

    expect(label).toMatch(/…$/)
    expect(label.length).toBeLessThan(courseName.length)
  })
})
