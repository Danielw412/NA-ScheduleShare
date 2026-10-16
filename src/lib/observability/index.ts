export { addBreadcrumb, addTransport, captureException, captureMessage, getBreadcrumbs, lastEventId, setTag, setUser } from './client'
export { isChunkLoadError } from './globalHandlers'
export { createLogger, logger, type Logger } from './logger'
export { routeTemplate } from './scrub'
export { createSentryTransport, scrubSentryBreadcrumb, scrubSentryEvent, type SentryLike } from './transports/sentry'
export type { Breadcrumb, CaptureContext, ObservabilityEvent, Severity, Transport } from './types'

/** First eight characters of an event id: short enough to read aloud or type into a report. */
export function errorReference(eventId: string | null | undefined): string | null {
  return eventId ? eventId.slice(0, 8).toUpperCase() : null
}
