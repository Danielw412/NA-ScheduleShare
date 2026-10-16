import { describe, expect, it, vi } from 'vitest'
import { createFunctionLogger, errorFields, observeHandler, scrubFields, serverIssueEvent } from './observability.ts'

function captureLines() {
  const lines: Array<Record<string, unknown>> = []
  return { lines, write: (line: string) => lines.push(JSON.parse(line)) }
}

const unavailable = () => Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } })

describe('edge function observability', () => {
  it('logs one structured, scrubbed line per request', async () => {
    const { lines, write } = captureLines()
    const handler = observeHandler(async (_request, logger) => {
      logger.info('step', { token: 'secret', note: 'mail jordan@example.com', count: 2 })
      return new Response('ok', { status: 200 })
    }, { functionName: 'delete-account', unavailable, write })

    const response = await handler(new Request('https://fn.test/', { method: 'POST', headers: { 'x-request-id': 'req-1' } }))

    expect(response.status).toBe(200)
    expect(lines[0]).toMatchObject({ level: 'info', event: 'step', function: 'delete-account', request_id: 'req-1', token: '[redacted]', note: 'mail [email]', count: 2 })
    expect(lines[1]).toMatchObject({ level: 'info', event: 'request_completed', method: 'POST', status: 200 })
    expect(typeof lines[1].duration_ms).toBe('number')
  })

  it('warns about handled server errors', async () => {
    const { lines, write } = captureLines()
    const handler = observeHandler(() => new Response('no', { status: 502 }), { functionName: 'site-reset', unavailable, write })
    await handler(new Request('https://fn.test/'))
    expect(lines[0]).toMatchObject({ level: 'warn', event: 'request_returned_server_error', status: 502 })
  })

  it('turns async crashes into the unavailable response and reports an issue', async () => {
    const { lines, write } = captureLines()
    const reportIssue = vi.fn(async () => undefined)
    const handler = observeHandler(async () => { throw new TypeError('Cannot read properties of undefined (reading "id")') }, {
      functionName: 'bell-schedule-sync', unavailable, reportIssue, release: 'abc123', write,
    })

    const response = await handler(new Request('https://fn.test/'))

    expect(response.status).toBe(503)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(lines[0]).toMatchObject({ level: 'error', event: 'request_failed', error_name: 'TypeError' })
    expect(reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: expect.stringMatching(/^fn-[0-9a-f]{14}$/),
      level: 'error',
      culprit: 'bell-schedule-sync',
      exception_type: 'TypeError',
      tags: { function: 'bell-schedule-sync', runtime: 'deno' },
      context: expect.objectContaining({ release: 'abc123' }),
    }))
  })

  it('still answers when issue reporting fails', async () => {
    const { lines, write } = captureLines()
    const handler = observeHandler(async () => { throw new Error('boom') }, {
      functionName: 'delete-account', unavailable, reportIssue: async () => { throw new Error('rpc down') }, write,
    })
    expect((await handler(new Request('https://fn.test/'))).status).toBe(503)
    expect(lines.some((line) => line.event === 'issue_report_failed')).toBe(true)
  })

  it('groups the same failure with different ids into one fingerprint', () => {
    const first = serverIssueEvent('schedule-import', 'r1', new Error('Row 42 for 96200000-0000-4000-8000-000000000001 failed'))
    const second = serverIssueEvent('schedule-import', 'r2', new Error('Row 7 for 96200000-0000-4000-8000-000000000002 failed'))
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.event_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('describes Supabase error objects and scrubs nested fields', () => {
    expect(errorFields({ message: 'permission denied', code: '42501' })).toMatchObject({ error_name: 'NonErrorThrown', error_message: 'permission denied', error_code: '42501' })
    expect(scrubFields({ nested: { authorization: 'Bearer x', ok: true } })).toEqual({ nested: { authorization: '[redacted]', ok: true } })
    const lines: string[] = []
    createFunctionLogger('f', 'r', (line) => lines.push(line)).warn('x', { password: 'p' })
    expect(JSON.parse(lines[0]).password).toBe('[redacted]')
  })
})
