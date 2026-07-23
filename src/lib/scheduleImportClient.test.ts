import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('./supabase/client', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  },
}))

import {
  submitScheduleScreenshots,
  type ScheduleImportDeveloperDiagnostics,
  type ScheduleImportResult,
} from './scheduleImport'

const result: ScheduleImportResult = { rows: [], warnings: [], image_count: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'verified-session-token' } }, error: null })
  mocks.invoke.mockResolvedValue({ data: result, error: null })
})

describe('Supabase Edge Function schedule importer client', () => {
  it('invokes the authenticated schedule-import function without a Cloudflare endpoint', async () => {
    const file = new File(['image'], 'schedule.png', { type: 'image/png' })
    await expect(submitScheduleScreenshots([file])).resolves.toMatchObject(result)
    expect(mocks.invoke).toHaveBeenCalledWith('schedule-import', { body: expect.any(FormData) })
    const form = mocks.invoke.mock.calls[0][1].body as FormData
    expect(form.getAll('images')).toEqual([file])
    expect(form.get('developer_mode')).toBe('false')
    expect(form.get('import_id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(form.get('model')).toBeNull()
  })

  it('sends admin developer overrides only when explicitly enabled', async () => {
    const file = new File(['image'], 'schedule.png', { type: 'image/png' })
    await submitScheduleScreenshots([file], {
      enabled: true,
      modelId: 'gemini-3.5-flash',
      thinkingLevel: 'high',
    })
    const form = mocks.invoke.mock.calls[0][1].body as FormData
    expect(form.get('developer_mode')).toBe('true')
    expect(form.get('model')).toBe('gemini-3.5-flash')
    expect(form.get('thinking_level')).toBe('high')
  })

  it('preserves admin diagnostics from a structured function error', async () => {
    const developer: ScheduleImportDeveloperDiagnostics = {
      prompt: 'exact prompt',
      raw_gemini_output: 'not json',
      parsed_output: null,
      validation_errors: ['invalid JSON'],
      model: 'gemini-3.5-flash-lite',
      thinking_level: 'low',
      output_token_limit: 4096,
      timing_ms: 120,
      image_metadata: [{ index: 1, mime_type: 'image/png', byte_size: 5 }],
      provider_error: null,
      diagnostic_log_id: '11111111-1111-4111-8111-111111111111',
    }
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: Response.json({ error: 'ai_invalid_response', message: 'Invalid output.', developer }, { status: 502 }),
      },
    })
    const promise = submitScheduleScreenshots([new File(['image'], 'schedule.png', { type: 'image/png' })], { enabled: true })
    await expect(promise).rejects.toMatchObject({
      message: 'Invalid output.',
      developer,
    })
  })
})
