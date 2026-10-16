import { computeFingerprint, normalizeMessage, topInAppFrame } from './fingerprint'
import { currentRoute, scrubData, scrubRecord, scrubText } from './scrub'
import { isExtensionFrame, parseStack } from './stack'
import type { Breadcrumb, CaptureContext, EventHint, ObservabilityEvent, Severity, Transport } from './types'

const MAX_BREADCRUMBS = 40
/** The same problem repeating in a tight loop is reported once per window. */
const DUPLICATE_WINDOW_MS = 30_000
/** Hard ceiling per page load so a crash loop cannot flood any transport. */
const MAX_EVENTS_PER_SESSION = 60

interface HubState {
  release: string
  environment: string
  user: { id: string } | null
  tags: Record<string, string>
  breadcrumbs: Breadcrumb[]
  transports: Transport[]
  recent: Map<string, { at: number; eventId: string }>
  sent: number
  lastEventId: string | null
  beforeSend?: (event: ObservabilityEvent) => ObservabilityEvent | null
}

const state: HubState = {
  release: 'development',
  environment: 'development',
  user: null,
  tags: {},
  breadcrumbs: [],
  transports: [],
  recent: new Map(),
  sent: 0,
  lastEventId: null,
}

export interface ObservabilityOptions {
  release: string
  environment: string
  transports: Transport[]
  beforeSend?: (event: ObservabilityEvent) => ObservabilityEvent | null
}

export function initObservability(options: ObservabilityOptions) {
  state.release = options.release
  state.environment = options.environment
  state.transports = options.transports
  state.beforeSend = options.beforeSend
}

/** Test hook: return the hub to a clean state. */
export function resetObservability() {
  state.release = 'development'
  state.environment = 'development'
  state.user = null
  state.tags = {}
  state.breadcrumbs = []
  state.transports = []
  state.recent.clear()
  state.sent = 0
  state.lastEventId = null
  state.beforeSend = undefined
}

export function addTransport(transport: Transport) {
  state.transports = [...state.transports.filter((item) => item.name !== transport.name), transport]
}

export function setUser(user: { id: string } | null) {
  state.user = user ? { id: user.id } : null
  for (const transport of state.transports) safely(() => transport.setUser?.(state.user))
}

export function setTag(key: string, value: string) {
  state.tags[key] = scrubText(value, 120)
}

export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp' | 'level'> & { level?: Severity; timestamp?: number }) {
  const entry: Breadcrumb = {
    timestamp: breadcrumb.timestamp ?? Date.now(),
    category: breadcrumb.category,
    message: scrubText(breadcrumb.message, 200),
    level: breadcrumb.level ?? 'info',
    data: breadcrumb.data ? scrubRecord(breadcrumb.data) : undefined,
  }
  state.breadcrumbs.push(entry)
  if (state.breadcrumbs.length > MAX_BREADCRUMBS) state.breadcrumbs.splice(0, state.breadcrumbs.length - MAX_BREADCRUMBS)
  for (const transport of state.transports) safely(() => transport.addBreadcrumb?.(entry))
}

export function getBreadcrumbs(): Breadcrumb[] {
  return [...state.breadcrumbs]
}

export function lastEventId(): string | null {
  return state.lastEventId
}

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '')
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function safely(action: () => unknown) {
  try {
    const result = action()
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    // A transport failure must never break the app or recurse into capture.
  }
}

/** Errors that are not ScheduleShare's to fix: browser noise and extensions. */
export function isIgnorableError(type: string, message: string, frames: ReturnType<typeof parseStack>): boolean {
  if (/ResizeObserver loop/i.test(message)) return true
  if (message === 'Script error.' || message === 'Script error') return true
  if (type === 'AbortError') return true
  if (frames.length > 0 && frames.every((frame) => isExtensionFrame(frame.filename))) return true
  if (/^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(message)
    && typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return false
}

function describe(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || 'Error', value: error.message || String(error), stack: error.stack }
  if (typeof error === 'string') return { type: 'Error', value: error }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    // Supabase/PostgREST errors are plain objects with code + message.
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(scrubData(record)).slice(0, 300)
    const code = typeof record.code === 'string' ? ` (${record.code})` : ''
    return { type: typeof record.name === 'string' ? record.name : 'NonErrorThrown', value: `${message}${code}` }
  }
  return { type: 'NonErrorThrown', value: String(error) }
}

function dispatch(event: ObservabilityEvent, hint: EventHint): string | null {
  const now = Date.now()
  const lastSeen = state.recent.get(event.fingerprint)
  // A repeat within the window is not sent again, but keeps the reference the
  // student was already shown, so the report link still points at the issue.
  if (lastSeen !== undefined && now - lastSeen.at < DUPLICATE_WINDOW_MS) return lastSeen.eventId
  if (state.sent >= MAX_EVENTS_PER_SESSION) return null
  const prepared = state.beforeSend ? state.beforeSend(event) : event
  if (!prepared) return null
  state.recent.set(event.fingerprint, { at: now, eventId: prepared.event_id })
  state.sent += 1
  state.lastEventId = prepared.event_id
  for (const transport of state.transports) safely(() => transport.send(prepared, hint))
  return prepared.event_id
}

function baseEvent(level: Severity, message: string, context: CaptureContext | undefined): Omit<ObservabilityEvent, 'fingerprint'> {
  return {
    event_id: newEventId(),
    timestamp: new Date().toISOString(),
    level,
    message,
    tags: { ...state.tags, ...Object.fromEntries(Object.entries(context?.tags ?? {}).map(([key, value]) => [key, scrubText(String(value), 120)])) },
    extra: scrubRecord(context?.extra),
    breadcrumbs: [...state.breadcrumbs],
    user: state.user,
    release: state.release,
    environment: state.environment,
    route: currentRoute(),
  }
}

/**
 * Report an exception. Returns the event id (shown to students as an error
 * reference) or null when the event was filtered, deduplicated, or capped.
 */
export function captureException(error: unknown, context?: CaptureContext): string | null {
  try {
    const { type, value, stack } = describe(error)
    const frames = parseStack(stack)
    const message = scrubText(value)
    if (isIgnorableError(type, value, frames)) return null
    const route = currentRoute()
    const frame = topInAppFrame(frames)
    const event: ObservabilityEvent = {
      ...baseEvent(context?.level ?? 'error', `${type}: ${message}`, context),
      exception: {
        type,
        value: message,
        stacktrace: frames,
        mechanism: { type: context?.mechanism ?? 'generic', handled: context?.handled ?? true },
      },
      fingerprint: context?.fingerprint ?? computeFingerprint(type, value, frames, route),
      culprit: frame?.filename ? `${frame.function ?? '<anonymous>'} (${frame.filename})` : route,
    }
    return dispatch(event, { originalException: error })
  } catch {
    return null
  }
}

export function captureMessage(message: string, level: Severity = 'info', context?: CaptureContext): string | null {
  try {
    const scrubbed = scrubText(message)
    const route = currentRoute()
    const event: ObservabilityEvent = {
      ...baseEvent(level, scrubbed, context),
      fingerprint: context?.fingerprint ?? `web-msg-${computeFingerprint('Message', normalizeMessage(scrubbed), [], route).slice(4)}`,
      culprit: route,
    }
    return dispatch(event, {})
  } catch {
    return null
  }
}
