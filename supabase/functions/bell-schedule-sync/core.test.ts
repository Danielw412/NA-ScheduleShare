import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeminiBellSyncRequest,
  currentEasternWeekBounds,
  currentWeeklyScheduleSection,
  fetchPublicGoogleDocumentText,
  handleBellScheduleSyncRequest,
  validateBellSyncExtraction,
  type BellSyncDependencies,
} from './core'

const source = `Weekly Schedule
Monday, August 24, 2026 — A Day — Activity Period
* Modified morning schedule
Tuesday, August 25, 2026 — B Day — Regular Bell Schedule
* Classes follow the regular bell schedule
Friday, August 28, 2026 — Student Activities Fair — Regular Bell Schedule
* Student Activities Fair during lunch

Student Council News
Friday, May 8, 2026 — Registration deadline
* Join last year's student council event

Weekly Schedule
Monday, August 17, 2026 — A Day — Regular Bell Schedule
* Welcome back
Friday, August 21, 2026 — Student Activities Fair — Regular Bell Schedule
* Student Activities Fair during lunch

Weekly Schedule
Monday, August 10, 2026 — A Day — Regular Bell Schedule
* Regular schedule`

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
    now: () => new Date('2026-08-23T16:00:00Z'),
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

  it('computes Sunday through Saturday boundaries from the Eastern calendar date', () => {
    expect(currentEasternWeekBounds('2026-08-23')).toEqual({ start: '2026-08-23', end: '2026-08-29' })
    expect(currentEasternWeekBounds('2026-08-29')).toEqual({ start: '2026-08-23', end: '2026-08-29' })
    expect(currentEasternWeekBounds('2026-08-30')).toEqual({ start: '2026-08-30', end: '2026-09-05' })
  })

  it('keeps only current-week headings and schedule bullets', () => {
    const selected = currentWeeklyScheduleSection(source, '2026-08-23', '2026-08-29')
    expect(selected).toContain('August 24')
    expect(selected).toContain('August 28')
    expect(selected).toContain('* Modified morning schedule')
    expect(selected).not.toContain('August 17')
    expect(selected).not.toContain('August 21')
    expect(selected).not.toContain('August 10')
    expect(selected).not.toContain('May 8')
    expect(selected).not.toContain('Student Council')
    expect(selected).not.toContain("last year's")
  })

  it('does not fall back when the current week is absent', () => {
    expect(() => currentWeeklyScheduleSection(source, '2026-08-30', '2026-09-05')).toThrow(/No Weekly Schedule was found for the current week/)
  })
})

describe('Gemini request and deterministic validation', () => {
  it('requests JSON with HIGH thinking and relies on strict local validation instead of provider schema support', () => {
    const currentSource = currentWeeklyScheduleSection(source, '2026-08-23', '2026-08-29')
    const requestBody = buildGeminiBellSyncRequest(currentSource, '2026-08-23', '2026-08-29')
    expect(requestBody.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false },
    })
    expect(requestBody.generationConfig).not.toHaveProperty('temperature')
    expect(requestBody.generationConfig).not.toHaveProperty('responseJsonSchema')
    expect(JSON.stringify(requestBody)).toContain('day_type')
    expect(JSON.stringify(requestBody)).toContain('UNKNOWN')
    expect(JSON.stringify(requestBody)).toContain('2026-08-23')
    expect(JSON.stringify(requestBody)).toContain('2026-08-29')
    expect(JSON.stringify(requestBody)).not.toContain('August 17')
  })

  it('maps the whole phrase activity period to Activity #1', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH',
      evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')
    expect(result[0].schedule_key).toBe('activity_1')
  })

  it('does not treat Student Activities Fair as activity period', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-28', day_type: null, no_school: false,
      schedule_key: 'activity_1', campus: 'NASH',
      evidence: 'Friday, August 28, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')
    expect(result[0].schedule_key).toBe('regular')
  })

  it('maps Gemini UNKNOWN day types back to the app null contract', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-28', day_type: 'UNKNOWN', no_school: false,
      schedule_key: 'regular', campus: 'NASH',
      evidence: 'Friday, August 28, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')
    expect(result[0].day_type).toBeNull()
  })

  it('overrides any hallucinated activity family for an Activities Fair alone', () => {
    const result = validateBellSyncExtraction([{
      date: '2026-08-28', day_type: 'A', no_school: false,
      schedule_key: 'activity_2', campus: 'NASH',
      evidence: 'Friday, August 28, 2026 — Student Activities Fair — Regular Bell Schedule',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')
    expect(result[0].schedule_key).toBe('regular')
  })

  it('rejects hallucinated evidence and safely ignores dates outside the bounded source window', () => {
    expect(() => validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence: 'This quote is not present',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')).toThrow(/evidence/i)
    expect(validateBellSyncExtraction([{
      date: '2027-05-28', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
    }], source, '2026-08-18', '2027-05-28', '2026-08-23')).toEqual([])
  })

  it('discards Gemini rows outside the exact current week and keeps valid in-week rows', () => {
    const result = validateBellSyncExtraction([
      {
        date: '2026-08-17', day_type: 'A', no_school: false,
        schedule_key: 'regular', campus: 'BOTH', evidence: 'not checked for an ignored row',
      },
      {
        date: '2026-08-24', day_type: 'A', no_school: false,
        schedule_key: 'regular', campus: 'BOTH', evidence: 'Monday, August 24, 2026 — A Day — Activity Period',
      },
      {
        date: '2026-08-30', day_type: 'B', no_school: false,
        schedule_key: 'regular', campus: 'BOTH', evidence: 'not checked for an ignored row',
      },
    ], source, '2026-08-18', '2027-05-28', '2026-08-23')
    expect(result).toEqual([expect.objectContaining({ date: '2026-08-24' })])
  })

  it('enforces the evidence length after extraction instead of using an unsupported schema keyword', () => {
    const evidence = 'x'.repeat(501)
    expect(() => validateBellSyncExtraction([{
      date: '2026-08-24', day_type: 'A', no_school: false,
      schedule_key: 'regular', campus: 'BOTH', evidence,
    }], evidence, '2026-08-18', '2027-05-28', '2026-08-23')).toThrow(/overly long evidence/i)
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
    const geminiCall = vi.mocked(deps.fetch).mock.calls.find(([input]) => String(input).includes('generativelanguage'))
    const geminiPayload = String(geminiCall?.[1]?.body)
    expect(geminiPayload).toContain('August 24')
    expect(geminiPayload).toContain('August 28')
    expect(geminiPayload).not.toContain('August 17')
    expect(geminiPayload).not.toContain('May 8')
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({
      sourceSection: expect.stringContaining('August 24'),
    }))
  })

  it('stops before Gemini and records a clear failure when the current week is missing', async () => {
    const deps = dependencies()
    deps.fetch = vi.fn(async () => new Response(`Weekly Schedule\nMonday, August 17, 2026 — A Day — Regular Bell Schedule`))
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'manual' }), deps)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'current_week_schedule_missing' })
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('current week'),
      validated: [],
    }))
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
