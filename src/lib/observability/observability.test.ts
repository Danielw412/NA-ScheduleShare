import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addBreadcrumb, captureException, captureMessage, initObservability, isIgnorableError, lastEventId, resetObservability, setUser } from './client'
import { computeFingerprint, normalizeMessage } from './fingerprint'
import { isChunkLoadError } from './globalHandlers'
import { instrumentFetch, requestOperation } from './instrumentFetch'
import { createLogger } from './logger'
import { routeTemplate, scrubData, scrubText } from './scrub'
import { normalizeFilename, parseStack } from './stack'
import { createDatabaseTransport, toIssueReport } from './transports/database'
import { createSentryTransport, scrubSentryBreadcrumb, scrubSentryEvent, type SentryLike, type SentryScopeLike } from './transports/sentry'
import type { ObservabilityEvent, Transport } from './types'

function recordingTransport() {
  const events: ObservabilityEvent[] = []
  const transport: Transport = { name: 'recording', send: (event) => { events.push(event) } }
  return { events, transport }
}

beforeEach(() => {
  resetObservability()
  window.location.hash = '#/students/96200000-0000-4000-8000-000000000001'
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('privacy scrubbing', () => {
  it('removes emails, tokens, share links, and long numbers from text', () => {
    const text = scrubText('jordan@example.com sent Bearer abc.def.ghi to /share/99300000-0000-4000-8000-000000000001?apikey=secret123 id 123456789012 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
    expect(text).toBe('[email] sent Bearer [token] to /share/[token]?apikey=[redacted] id [number] [token]')
  })

  it('redacts sensitive keys and bounds nested data', () => {
    expect(scrubData({ full_name: 'Jordan Smith', password: 'x', nested: { email: 'a@b.co', status: 500 }, list: Array.from({ length: 30 }, (_, index) => index) })).toEqual({
      full_name: '[redacted]',
      password: '[redacted]',
      nested: { email: '[redacted]', status: 500 },
      list: Array.from({ length: 20 }, (_, index) => index),
    })
  })

  it('turns routes into templates without ids or tokens', () => {
    expect(routeTemplate('/students/96200000-0000-4000-8000-000000000001')).toBe('/students/:id')
    expect(routeTemplate('/share/abc-token?x=1')).toBe('/share/:token')
    expect(routeTemplate('/classes/42')).toBe('/classes/:n')
  })
})

describe('stack parsing and grouping', () => {
  const chromeStack = `TypeError: Cannot read properties of undefined (reading 'map')
    at renderRows (https://schedule.naclubs.net/assets/HomePage-Bx12Ab9z.js:10:20)
    at Object.render (https://schedule.naclubs.net/assets/index-Q1w2E3r4.js:2:3)`

  it('parses Chrome and Firefox frames and strips build hashes', () => {
    const frames = parseStack(chromeStack)
    expect(frames[0]).toMatchObject({ function: 'renderRows', filename: 'assets/HomePage.js', lineno: 10, colno: 20, in_app: true })
    expect(parseStack('render@https://x.test/assets/Page-abcdef12.js:5:6')[0]).toMatchObject({ function: 'render', filename: 'assets/Page.js' })
    expect(normalizeFilename('https://x.test/assets/AdminPage-a1B2c3D4.js')).toBe('assets/AdminPage.js')
  })

  it('groups the same bug across deploys and different ids', () => {
    const first = computeFingerprint('TypeError', 'Cannot read 42 of user 96200000-0000-4000-8000-000000000001', parseStack(chromeStack), '/')
    const second = computeFingerprint('TypeError', 'Cannot read 7 of user 96200000-0000-4000-8000-000000000002', parseStack(chromeStack.replace('Bx12Ab9z', 'Zz98Yy76')), '/')
    expect(first).toBe(second)
    expect(first).toMatch(/^web-[0-9a-f]{14}$/)
    expect(normalizeMessage('Request "abc" failed after 3 tries')).toBe('Request <str> failed after <n> tries')
  })

  it('ignores browser noise and extension errors', () => {
    expect(isIgnorableError('Error', 'ResizeObserver loop completed with undelivered notifications.', [])).toBe(true)
    expect(isIgnorableError('Error', 'Script error.', [])).toBe(true)
    expect(isIgnorableError('Error', 'boom', [{ filename: 'chrome-extension://abc/content.js', in_app: false }])).toBe(true)
    expect(isIgnorableError('TypeError', 'Cannot read properties of undefined', [])).toBe(false)
  })

  it('recognizes stale chunks after a deploy', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/HomePage-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Something else'))).toBe(false)
  })
})

describe('capture', () => {
  it('builds a scrubbed event with breadcrumbs, route, release, and only the account id', () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'abc123', environment: 'production', transports: [transport] })
    setUser({ id: 'user-1' })
    addBreadcrumb({ category: 'navigation', message: '/ → /students/:id' })

    const id = captureException(new TypeError('Cannot load jordan@example.com'), { tags: { boundary: 'route' }, extra: { token: 'abc', count: 2 } })

    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(lastEventId()).toBe(id)
    const [event] = events
    expect(event).toMatchObject({
      level: 'error',
      message: 'TypeError: Cannot load [email]',
      release: 'abc123',
      environment: 'production',
      route: '/students/:id',
      user: { id: 'user-1' },
      tags: { boundary: 'route' },
      extra: { token: '[redacted]', count: 2 },
    })
    expect(event.exception?.type).toBe('TypeError')
    expect(event.breadcrumbs.at(-1)?.message).toBe('/ → /students/:id')
  })

  it('reports a repeating problem once per window and caps a crash loop', () => {
    vi.useFakeTimers()
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    const first = captureException(new Error('Loop'))
    const repeat = captureException(new Error('Loop'))
    expect(events).toHaveLength(1)
    expect(repeat).toBe(first)
    vi.advanceTimersByTime(31_000)
    captureException(new Error('Loop'))
    expect(events).toHaveLength(2)
    for (let index = 0; index < 100; index += 1) captureMessage(`distinct message ${String.fromCharCode(65 + (index % 26))}${index > 25 ? 'x'.repeat(index) : ''}`, 'error')
    expect(events.length).toBeLessThanOrEqual(60)
  })

  it('describes Supabase error objects', () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    captureException({ message: 'permission denied', code: '42501' })
    expect(events[0].message).toBe('NonErrorThrown: permission denied (42501)')
  })

  it('never lets a failing transport break the app', () => {
    initObservability({ release: 'r', environment: 'production', transports: [{ name: 'broken', send: () => { throw new Error('transport down') } }] })
    expect(() => captureException(new Error('original'))).not.toThrow()
  })

  it('logs warnings as breadcrumbs and errors as issues', () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = createLogger('schedule')
    log.warn('Slow response', { duration_ms: 3000 })
    log.error('Could not save', new Error('save failed'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ tags: { scope: 'schedule' }, extra: { log_message: 'Could not save' } })
    expect(events[0].breadcrumbs.some((crumb) => crumb.message === 'Slow response' && crumb.level === 'warning')).toBe(true)
  })
})

describe('transports', () => {
  it('sends only warnings and errors to the issue store, in the accepted shape', async () => {
    vi.useFakeTimers()
    const report = vi.fn<(payload: unknown) => Promise<void>>(async () => undefined)
    const transport = createDatabaseTransport(report)
    initObservability({ release: 'abc', environment: 'production', transports: [transport] })
    captureMessage('just info', 'info')
    captureException(new Error('real problem'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({ level: 'error', message: 'Error: real problem', exception_type: 'Error', context: { route: '/students/:id', release: 'abc' } })
  })

  it('shapes reports with bounded breadcrumbs', () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    for (let index = 0; index < 35; index += 1) addBreadcrumb({ category: 'test', message: `crumb ${index}` })
    captureException(new Error('x'))
    const report = toIssueReport(events[0])
    expect(report.breadcrumbs).toHaveLength(20)
    expect(report.breadcrumbs.at(-1)?.message).toBe('crumb 34')
  })

  it('maps events onto a Sentry-compatible SDK', () => {
    const scope: SentryScopeLike = { setLevel: vi.fn(), setFingerprint: vi.fn(), setTags: vi.fn(), setExtras: vi.fn(), setContext: vi.fn() }
    const sentry: SentryLike = {
      withScope: (callback) => callback(scope),
      captureException: vi.fn(() => 'sentry-id'),
      captureMessage: vi.fn(() => 'sentry-id'),
      addBreadcrumb: vi.fn(),
      setUser: vi.fn(),
    }
    initObservability({ release: 'r', environment: 'production', transports: [createSentryTransport(sentry)] })
    const error = new TypeError('boom for jordan@example.com')
    captureException(error)
    setUser({ id: 'user-1' })
    const sent = vi.mocked(sentry.captureException).mock.calls[0][0] as Error
    expect(sent).not.toBe(error)
    expect(sent.name).toBe('TypeError')
    expect(sent.message).toBe('boom for [email]')
    expect(scope.setFingerprint).toHaveBeenCalledWith([expect.stringMatching(/^web-/)])
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' })
  })
})

describe('Sentry scrubbers', () => {
  it('removes personal data that Sentry collects on its own', () => {
    const event = scrubSentryEvent({
      message: 'Failed for jordan@example.com',
      request: { url: 'https://schedule.naclubs.net/?x=1#/students/96200000-0000-4000-8000-000000000001', headers: { cookie: 'a' }, query_string: 'x=1' },
      exception: { values: [{ value: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' }] },
      breadcrumbs: [{ message: 'navigate', data: { from: 'https://x.test/#/share/abc', to: 'https://x.test/#/' } }],
      user: { id: 'user-1', email: 'jordan@example.com', username: 'Jordan' },
      extra: { full_name: 'Jordan Smith' },
    })
    expect(event.message).toBe('Failed for [email]')
    expect(event.request).toEqual({ url: 'https://schedule.naclubs.net/#/students/:id' })
    expect(event.exception?.values?.[0].value).toBe('token [token]')
    expect(event.breadcrumbs?.[0].data).toEqual({ from: 'https://x.test/#/share/[token]', to: 'https://x.test/#/' })
    expect(event.user).toEqual({ id: 'user-1' })
    expect(event.extra).toEqual({ full_name: '[redacted]' })
    expect(scrubSentryBreadcrumb({ message: 'fetch https://x.test/rest/v1/rpc/f?apikey=abc' }).message).toBe('fetch https://x.test/rest/v1/rpc/f?apikey=[redacted]')
  })
})

describe('request instrumentation', () => {
  it('records Supabase requests as breadcrumbs and reports server errors', async () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    const base = vi.fn(async (input: RequestInfo | URL) => new Response('{}', { status: String(input).includes('broken') ? 503 : 200 }))
    const instrumented = instrumentFetch(base as typeof fetch)

    await instrumented('https://db.example/rest/v1/rpc/get_my_schedule?select=*', { method: 'POST' })
    await instrumented('https://db.example/rest/v1/rpc/broken_rpc', { method: 'POST' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ level: 'warning', message: 'Supabase /rest/v1/rpc/broken_rpc responded with 503', tags: { status: '503' } })
    expect(events[0].breadcrumbs.map((crumb) => crumb.message)).toEqual(['POST /rest/v1/rpc/get_my_schedule', 'POST /rest/v1/rpc/broken_rpc'])
  })

  it('does not observe its own issue reports', async () => {
    const { events, transport } = recordingTransport()
    initObservability({ release: 'r', environment: 'production', transports: [transport] })
    const base = vi.fn(async () => new Response('{}', { status: 500 }))
    await instrumentFetch(base as typeof fetch)('https://db.example/rest/v1/rpc/report_app_issue', { method: 'POST' })
    expect(events).toHaveLength(0)
    expect(requestOperation('https://db.example/storage/v1/object/profile-pictures/96200000-0000-4000-8000-000000000001/avatar')).toBe('/storage/v1/object/profile-pictures/:id/avatar')
  })
})
