import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeminiBellSyncRequest,
  fetchPublicGoogleDocumentText,
  handleBellScheduleSyncRequest,
  newestWeeklyScheduleSections,
  validateBellSyncExtraction,
  type BellSyncDependencies,
} from './core'

const source = `Weekly Schedule
Monday, August 24, 2026 — A Day — Activity Period
Tuesday, August 25, 2026 — B Day — Regular Bell Schedule

Weekly Schedule
Friday, August 21, 2026 — Student Activities Fair — Regular Bell Schedule

Weekly Schedule
Monday, August 10, 2026 — A Day — Regular Bell Schedule`

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://project.supabase.co/functions/v1/bell-schedule-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token', ...headers },
    body: JSON.stringify(body),
  })
}

function dependencies(): BellSyncDependencies {
  const extraction = [{
    date: '2026-08-24', day_type: 'A', no_school: false,
    schedule_key: 'activity_1', campus: 'BOTH',
    evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
  }]
  return {
    geminiApiKey: 'gemini-key',
    schedulerToken: 'scheduler-token',
    now: () => new Date('2026-08-22T16:00:00Z'),
    verifyUser: vi.fn(async () => ({ id: 'admin-id' })),
    verifyAdmin: vi.fn(async () => true),
    claim: vi.fn(async () => ({
      claimed: true,
      run_id: 'run-id',
      model_id: 'gemini-3.1-flash-lite',
      school_year_start: '2026-08-18',
      school_year_end: '2027-05-28',
      newsletter_document_url: 'https://docs.google.com/document/d/news-doc/edit',
    })),
    finish: vi.fn(async (input) => ({ run_id: input.runId, status: input.status })),
    fetch: vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('news-doc')) return new Response(source, { headers: { 'Content-Type': 'text/plain' } })
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }] })
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('Google Docs extraction', () => {
  it('reads the anonymous plain-text export without an API key or authorization header', async () => {
    const fetcher = vi.fn(async () => new Response('Public document text', { headers: { 'Content-Type': 'text/plain' } }))
    await expect(fetchPublicGoogleDocumentText('https://docs.google.com/document/d/public-doc/edit', fetcher)).resolves.toBe('Public document text')
    const [input, init] = fetcher.mock.calls[0]
    const endpoint = new URL(String(input))
    expect(endpoint.origin).toBe('https://docs.google.com')
    expect(endpoint.pathname).toBe('/document/d/public-doc/export')
    expect(endpoint.searchParams.get('format')).toBe('txt')
    expect(endpoint.searchParams.has('key')).toBe(false)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('keeps only the newest two Weekly Schedule sections', () => {
    const selected = newestWeeklyScheduleSections(source, new Date('2026-08-22T12:00:00Z'))
    expect(selected).toContain('August 24')
    expect(selected).toContain('August 21')
    expect(selected).not.toContain('August 10')
  })
})

describe('Gemini request and deterministic validation', () => {
  it('forces structured JSON, HIGH thinking, no thoughts, and model-default sampling', () => {
    const requestBody = buildGeminiBellSyncRequest(source)
    expect(requestBody.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false },
    })
    expect(requestBody.generationConfig).not.toHaveProperty('temperature')
    expect(JSON.stringify(requestBody)).not.toContain('maxLength')
    expect(JSON.stringify(requestBody)).toContain('"enum":["A","B","UNKNOWN"]')
  })

  it('maps the whole phrase activity period to Activity #1', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH',
      evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')
    expect(result[0].schedule_key).toBe('activity_1')
  })

  it('does not treat Student Activities Fair as activity period', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-21', day_type: null, no_school: false,
      schedule_key: 'activity_1', campus: 'NASH',
      evidence: 'Friday, August 21, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')
    expect(result[0].schedule_key).toBe('regular')
  })

  it('maps Gemini UNKNOWN day types back to the app null contract', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-21', day_type: 'UNKNOWN', no_school: false,
      schedule_key: 'regular', campus: 'NASH',
      evidence: 'Friday, August 21, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')
    expect(result[0].day_type).toBeNull()
  })

  it('overrides any hallucinated activity family for an Activities Fair alone', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-21', day_type: 'A', no_school: false,
      schedule_key: 'activity_2', campus: 'NASH',
      evidence: 'Friday, August 21, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')
    expect(result[0].schedule_key).toBe('regular')
  })

  it('rejects hallucinated evidence and dates outside the bounded source window', () => {
    expect(() => validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence: 'This quote is not present',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')).toThrow(/evidence/i)
    expect(() => validateBellSyncExtraction([{
      date: '2027-05-28', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
    }], source, '2026-08-18', '2027-05-28', '2026-08-22')).toThrow(/out-of-bounds/i)
  })

  it('enforces the evidence length after extraction instead of using an unsupported schema keyword', () => {
    const evidence = 'x'.repeat(501)
    expect(() => validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence,
    }], evidence, '2026-08-18', '2027-05-28', '2026-08-22')).toThrow(/overly long evidence/i)
  })
})

describe('bell-schedule sync request', () => {
  it('verifies an admin, reads only the newsletter, invokes Gemini, and finishes a preview without applying', async () => {
    const deps = dependencies()
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'manual', preview: true }), deps)
    expect(response.status).toBe(200)
    expect(deps.verifyAdmin).toHaveBeenCalledWith('admin-token')
    expect(deps.claim).toHaveBeenCalledWith('admin-id', 'manual', true)
    expect(deps.fetch).toHaveBeenCalledTimes(2)
    expect(deps.fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/document/d/news-doc/export' }), expect.anything())
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'previewed', validated: [expect.objectContaining({ schedule_key: 'activity_1' })] }))
  })

  it('requires the scheduled token and does not trust a browser trigger', async () => {
    const deps = dependencies()
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'scheduled' }, { 'x-bell-schedule-sync-token': 'wrong' }), deps)
    expect(response.status).toBe(401)
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it('returns an idempotent no-op when the database declines a duplicate claim', async () => {
    const deps = dependencies()
    deps.claim = vi.fn(async () => ({ claimed: false, reason: 'already_claimed' }))
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'scheduled' }, { 'x-bell-schedule-sync-token': 'scheduler-token' }), deps)
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ claimed: false, reason: 'already_claimed' })
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('records a bounded safe failure when Google or Gemini fails', async () => {
    const deps = dependencies()
    deps.fetch = vi.fn(async () => Response.json({ error: 'quota' }, { status: 429 }))
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'manual' }), deps)
    expect(response.status).toBe(502)
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: expect.stringContaining('Google Docs') }))
  })

  it('records the bounded Gemini provider reason when a request is rejected', async () => {
    const deps = dependencies()
    deps.fetch = vi.fn(async (input) => {
      if (String(input).includes('news-doc')) return new Response(source, { headers: { 'Content-Type': 'text/plain' } })
      return Response.json({ error: {
        message: 'Invalid JSON payload.',
        details: [{ fieldViolations: [{ field: 'generationConfig.responseJsonSchema', description: `Unsupported keyword. ${'x'.repeat(600)}` }] }],
      } }, { status: 400 })
    })
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'manual' }), deps)
    const body = await response.json()
    expect(response.status).toBe(502)
    expect(body.message).toContain('Invalid JSON payload')
    expect(body.message).toContain('generationConfig.responseJsonSchema')
    expect(body.message.length).toBeLessThan(560)
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('Invalid JSON payload'),
    }))
  })
})
