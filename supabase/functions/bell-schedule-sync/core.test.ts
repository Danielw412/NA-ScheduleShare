import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeminiBellSyncRequest,
  extractGoogleDocumentText,
  handleBellScheduleSyncRequest,
  newestWeeklyScheduleSections,
  validateBellSyncExtraction,
  type BellSyncDependencies,
} from './core'

function paragraph(text: string) {
  return { paragraph: { elements: [{ textRun: { content: text } }] } }
}

function googleDoc(text: string) {
  return { tabs: [{ documentTab: { body: { content: [paragraph(text)] } }, childTabs: [] }] }
}

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
    googleDocsApiKey: 'google-key',
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
      bell_schedule_document_url: 'https://docs.google.com/document/d/bell-doc/edit',
      newsletter_document_url: 'https://docs.google.com/document/d/news-doc/edit',
    })),
    finish: vi.fn(async (input) => ({ run_id: input.runId, status: input.status })),
    fetch: vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('bell-doc')) return Response.json(googleDoc('Regular Bell Schedule\nPeriod 1 7:28-8:08'))
      if (url.includes('news-doc')) return Response.json(googleDoc(source))
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }] })
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('Google Docs extraction', () => {
  it('traverses paragraphs, tables, tabs, and child tabs', () => {
    const document = {
      tabs: [{
        documentTab: { body: { content: [paragraph('Heading\n'), { table: { tableRows: [{ tableCells: [{ content: [paragraph('A1')] }, { content: [paragraph('B1')] }] }] } }] } },
        childTabs: [{ documentTab: { body: { content: [paragraph('Child tab')] } } }],
      }],
    }
    const text = extractGoogleDocumentText(document)
    expect(text).toContain('Heading')
    expect(text).toContain('A1\tB1')
    expect(text).toContain('Child tab')
  })

  it('keeps only the newest two Weekly Schedule sections', () => {
    const selected = newestWeeklyScheduleSections(source, new Date('2026-08-22T12:00:00Z'))
    expect(selected).toContain('August 24')
    expect(selected).toContain('August 21')
    expect(selected).not.toContain('August 10')
  })
})

describe('Gemini request and deterministic validation', () => {
  it('forces structured JSON, temperature zero, HIGH thinking, and no thoughts', () => {
    const requestBody = buildGeminiBellSyncRequest(source)
    expect(requestBody.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false },
    })
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
})

describe('bell-schedule sync request', () => {
  it('verifies an admin, reads both Docs, invokes Gemini, and finishes a preview without applying', async () => {
    const deps = dependencies()
    const response = await handleBellScheduleSyncRequest(request({ trigger: 'manual', preview: true }), deps)
    expect(response.status).toBe(200)
    expect(deps.verifyAdmin).toHaveBeenCalledWith('admin-token')
    expect(deps.claim).toHaveBeenCalledWith('admin-id', 'manual', true)
    expect(deps.fetch).toHaveBeenCalledTimes(3)
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
})
