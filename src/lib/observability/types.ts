/**
 * Event shapes modeled on Sentry's event payload so the first-party issue
 * store and a future Sentry transport receive the same information.
 */
export type Severity = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

export interface Breadcrumb {
  timestamp: number
  category: string
  message: string
  level: Severity
  data?: Record<string, unknown>
}

export interface StackFrame {
  function?: string
  filename?: string
  lineno?: number
  colno?: number
  in_app: boolean
}

export interface ExceptionInfo {
  type: string
  value: string
  stacktrace: StackFrame[]
  mechanism: { type: string; handled: boolean }
}

export interface ObservabilityEvent {
  /** 32 lowercase hex characters, like Sentry event ids. */
  event_id: string
  timestamp: string
  level: Severity
  message: string
  exception?: ExceptionInfo
  /** Grouping key: events with the same fingerprint are one issue. */
  fingerprint: string
  /** Where it happened, e.g. "HomePage (assets/HomePage.js)". */
  culprit?: string
  tags: Record<string, string>
  extra: Record<string, unknown>
  breadcrumbs: Breadcrumb[]
  /** Only an opaque account id is ever attached — never names or emails. */
  user: { id: string } | null
  release: string
  environment: string
  /** Route template with ids removed, e.g. "/students/:id". */
  route: string
}

export interface CaptureContext {
  level?: Severity
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  /** Replaces the computed grouping key. */
  fingerprint?: string
  mechanism?: string
  handled?: boolean
}

export interface EventHint {
  /** The original thrown value, for transports (like Sentry) that parse it themselves. */
  originalException?: unknown
}

export interface Transport {
  name: string
  send(event: ObservabilityEvent, hint: EventHint): void | Promise<void>
  addBreadcrumb?(breadcrumb: Breadcrumb): void
  setUser?(user: { id: string } | null): void
}
