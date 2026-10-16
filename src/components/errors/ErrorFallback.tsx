import { RefreshCw, TriangleAlert } from 'lucide-react'
import { errorReference, isChunkLoadError } from '../../lib/observability'
import type { ErrorFallbackProps } from './ErrorBoundary'

interface ErrorFallbackViewProps extends ErrorFallbackProps {
  /** The root boundary sits outside the router and the app shell. */
  fullscreen?: boolean
}

/**
 * Recovery screen. A stale tab after a deploy gets a one-tap reload; any other
 * crash gets a short explanation, an error reference to include in a report,
 * and ways to continue.
 */
export function ErrorFallback({ error, eventId, reset, fullscreen = false }: ErrorFallbackViewProps) {
  const reference = errorReference(eventId)
  const reportHref = `#/report${reference ? `?error=${encodeURIComponent(reference)}` : ''}`

  if (isChunkLoadError(error)) {
    return (
      <div className={fullscreen ? 'error-state is-fullscreen' : 'error-state'} role="alert">
        <span className="error-state-icon"><RefreshCw aria-hidden="true" /></span>
        <h1>ScheduleShare was updated</h1>
        <p>This page is from an older version. Reload to get the latest one. Nothing you saved is lost.</p>
        <div className="form-actions">
          <button className="button button-primary" type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />Reload</button>
        </div>
      </div>
    )
  }

  return (
    <div className={fullscreen ? 'error-state is-fullscreen' : 'error-state'} role="alert">
      <span className="error-state-icon"><TriangleAlert aria-hidden="true" /></span>
      <h1>This page ran into a problem</h1>
      <p>Your schedule and settings are safe. Try again, or let us know what happened so we can fix it.</p>
      {reference ? <p className="error-state-reference">Error reference <strong className="numeric">{reference}</strong></p> : null}
      <div className="form-actions">
        <button className="button button-primary" type="button" onClick={fullscreen ? () => window.location.reload() : reset}>{fullscreen ? 'Reload' : 'Try again'}</button>
        <a className="button button-secondary" href="#/">Go to Today</a>
        <a className="text-button" href={reportHref}>Report this problem</a>
      </div>
    </div>
  )
}
