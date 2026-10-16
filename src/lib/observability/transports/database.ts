import type { ObservabilityEvent, StackFrame, Transport } from '../types'

/** Fields the issue store accepts; everything else stays in the browser. */
export interface IssueReportPayload {
  event_id: string
  fingerprint: string
  level: ObservabilityEvent['level']
  message: string
  culprit: string | null
  exception_type: string | null
  handled: boolean | null
  mechanism: string | null
  stacktrace: StackFrame[]
  breadcrumbs: ObservabilityEvent['breadcrumbs']
  tags: Record<string, string>
  context: Record<string, unknown>
}

const MAX_BREADCRUMBS_SENT = 20
const MAX_PER_SESSION = 25
const FLUSH_DELAY_MS = 1500

export function toIssueReport(event: ObservabilityEvent): IssueReportPayload {
  const viewport = typeof window === 'undefined' ? null : `${window.innerWidth}x${window.innerHeight}`
  return {
    event_id: event.event_id,
    fingerprint: event.fingerprint,
    level: event.level,
    message: event.message.slice(0, 500),
    culprit: event.culprit?.slice(0, 300) ?? null,
    exception_type: event.exception?.type.slice(0, 120) ?? null,
    handled: event.exception?.mechanism.handled ?? null,
    mechanism: event.exception?.mechanism.type ?? null,
    stacktrace: (event.exception?.stacktrace ?? []).slice(0, 30),
    breadcrumbs: event.breadcrumbs.slice(-MAX_BREADCRUMBS_SENT),
    tags: event.tags,
    context: {
      route: event.route,
      release: event.release,
      environment: event.environment,
      viewport,
      user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 200),
      extra: event.extra,
    },
  }
}

/**
 * First-party issue store transport. Events are batched briefly, capped per
 * page load, and sent through a bounded, rate-limited RPC. Failures are
 * dropped silently: reporting must never cause more errors.
 */
export function createDatabaseTransport(report: (payload: IssueReportPayload) => Promise<void>): Transport {
  const queue: IssueReportPayload[] = []
  let sent = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function flush() {
    timer = null
    while (queue.length > 0 && sent < MAX_PER_SESSION) {
      const payload = queue.shift()!
      sent += 1
      try {
        await report(payload)
      } catch {
        // Dropped on purpose.
      }
    }
    queue.length = 0
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { if (queue.length) void flush() })
  }

  return {
    name: 'database',
    send(event) {
      if (event.level === 'debug' || event.level === 'info') return
      if (sent + queue.length >= MAX_PER_SESSION) return
      queue.push(toIssueReport(event))
      // Errors go out at once (a reload may follow); warnings batch briefly.
      if (event.level === 'error' || event.level === 'fatal') {
        if (timer !== null) clearTimeout(timer)
        timer = null
        void flush()
      } else if (timer === null) {
        timer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
      }
    },
  }
}
