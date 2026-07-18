import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleShareRequest, type ShareEnv } from '../src/share'

const TOKEN = '99300000-0000-4000-8000-000000000001'
const env: ShareEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
}

afterEach(() => vi.restoreAllMocks())

function mockShare(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)))
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
    expect(html).toContain('<meta property="og:title"')
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain(`<meta property="og:url" content="https://share.example/share/${TOKEN}">`)
    expect(html).toContain(`<meta property="og:image" content="https://share.example/share/${TOKEN}/image.png">`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('Biology &lt;script&gt;')
    expect(html).not.toContain('student@example.com')
    expect(html).not.toContain('private-user-id')
    expect(html).not.toContain('Biology <script>')
  })

  it('returns the same safe generic page for private, disabled, and invalid links', async () => {
    mockShare({ available: false, schedule: [] })
    const privateResponse = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}`), env)
    const invalidResponse = await handleShareRequest(new Request('https://share.example/share/not-a-token'), env)
    const privateHtml = await privateResponse?.text()
    const invalidHtml = await invalidResponse?.text()

    expect(privateResponse?.status).toBe(404)
    expect(invalidResponse?.status).toBe(404)
    expect(privateHtml).toContain('This schedule isn’t available')
    expect(invalidHtml).toContain('This schedule isn’t available')
    expect(privateHtml).not.toContain('course_name')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('schedule preview image', () => {
  it('returns a public 1200 × 630 PNG for a visible schedule', async () => {
    mockShare({
      available: true,
      schedule: [
        { day_type: 'A', period_number: 1, course_name: 'AP Statistics', academic_term: 'full_year' },
        { day_type: 'B', period_number: 3, course_name: 'English 11', academic_term: 'full_year' },
      ],
    })
    const response = await handleShareRequest(new Request(`https://share.example/share/${TOKEN}/image.png`), env)
    const bytes = new Uint8Array(await response!.arrayBuffer())
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Content-Type')).toBe('image/png')
    expect([...bytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10])
    expect(view.getUint32(16)).toBe(1200)
    expect(view.getUint32(20)).toBe(630)
    expect(bytes.length).toBeGreaterThan(700_000)
  })
})
