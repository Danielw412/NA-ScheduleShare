import { routeTemplate, scrubData, scrubText } from '../scrub'
import type { Breadcrumb, ObservabilityEvent, Severity, Transport } from '../types'

/**
 * The subset of the @sentry/react (or @sentry/browser) API this adapter uses.
 * Declared structurally so ScheduleShare compiles without the SDK installed.
 * Enabling Sentry is described in docs/observability.md.
 */
export interface SentryScopeLike {
  setLevel(level: Severity): void
  setFingerprint(fingerprint: string[]): void
  setTags(tags: Record<string, string>): void
  setExtras(extras: Record<string, unknown>): void
  setContext(name: string, context: Record<string, unknown> | null): void
}

export interface SentryLike {
  withScope(callback: (scope: SentryScopeLike) => void): void
  captureException(exception: unknown): string
  captureMessage(message: string): string
  addBreadcrumb(breadcrumb: { timestamp?: number; category?: string; message?: string; level?: Severity; data?: Record<string, unknown> }): void
  setUser(user: { id: string } | null): void
}

export function createSentryTransport(sentry: SentryLike): Transport {
  return {
    name: 'sentry',
    send(event: ObservabilityEvent, hint) {
      sentry.withScope((scope) => {
        scope.setLevel(event.level)
        scope.setFingerprint([event.fingerprint])
        scope.setTags({ ...event.tags, route: event.route, scheduleshare_event_id: event.event_id })
        scope.setExtras(event.extra)
        scope.setContext('scheduleshare', { route: event.route, culprit: event.culprit ?? null })
        // Send a scrubbed copy, never the raw error: its message could hold
        // an email or token. The original stack is kept (scrubbed) so Sentry
        // can still apply source maps.
        if (event.exception) {
          const error = new Error(event.exception.value)
          error.name = event.exception.type
          const original = hint.originalException
          if (original instanceof Error && original.stack) error.stack = scrubText(original.stack, 8000)
          sentry.captureException(error)
        } else {
          sentry.captureMessage(event.message)
        }
      })
    },
    addBreadcrumb(breadcrumb: Breadcrumb) {
      sentry.addBreadcrumb({ ...breadcrumb, timestamp: breadcrumb.timestamp / 1000 })
    },
    setUser(user) {
      sentry.setUser(user)
    },
  }
}

/** Shape of the Sentry event fields the scrubber touches. */
interface SentryEventLike {
  message?: string
  request?: { url?: string; query_string?: unknown; headers?: unknown; cookies?: unknown; data?: unknown }
  exception?: { values?: Array<{ value?: string }> }
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  user?: { id?: string } & Record<string, unknown>
  extra?: Record<string, unknown>
}

function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    const route = parsed.hash.startsWith('#/') ? `#${routeTemplate(parsed.hash.slice(1))}` : ''
    return `${parsed.origin}${routeTemplate(parsed.pathname)}${route}`
  } catch {
    return scrubText(url, 200)
  }
}

/**
 * Pass as `beforeSend` to Sentry.init. Applies ScheduleShare's privacy rules
 * to data Sentry's own integrations collect (request URL, breadcrumbs, user).
 */
export function scrubSentryEvent<Event extends SentryEventLike>(event: Event): Event {
  if (event.message) event.message = scrubText(event.message)
  for (const value of event.exception?.values ?? []) if (value.value) value.value = scrubText(value.value)
  if (event.request) {
    event.request.url = scrubUrl(event.request.url)
    delete event.request.query_string
    delete event.request.headers
    delete event.request.cookies
    delete event.request.data
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => scrubSentryBreadcrumb(breadcrumb))
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : {}
  if (event.extra) event.extra = scrubData(event.extra) as Record<string, unknown>
  return event
}

/** Pass as `beforeBreadcrumb` to Sentry.init. */
export function scrubSentryBreadcrumb<Crumb extends { message?: string; data?: Record<string, unknown> }>(breadcrumb: Crumb): Crumb {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message, 200)
  if (breadcrumb.data) {
    const data: Record<string, unknown> = { ...breadcrumb.data }
    for (const key of ['url', 'from', 'to']) if (typeof data[key] === 'string') data[key] = scrubUrl(data[key] as string)
    breadcrumb.data = scrubData(data) as Record<string, unknown>
  }
  return breadcrumb
}
