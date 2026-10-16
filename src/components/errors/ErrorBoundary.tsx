import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureException } from '../../lib/observability'
import { isChunkLoadError } from '../../lib/observability/globalHandlers'

export interface ErrorFallbackProps {
  error: unknown
  eventId: string | null
  reset: () => void
}

interface ErrorBoundaryProps {
  /** Names the boundary in reports, e.g. "route" or "app". */
  scope: string
  fallback: (props: ErrorFallbackProps) => ReactNode
  /** Changing any of these values clears the error (e.g. the route path). */
  resetKeys?: unknown[]
  children: ReactNode
}

interface ErrorBoundaryState {
  error: unknown
  hasError: boolean
  eventId: string | null
  resetKeys: unknown[] | undefined
}

/**
 * Catches render errors, reports them with the component stack, and shows a
 * recovery screen instead of a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, hasError: false, eventId: null, resetKeys: this.props.resetKeys }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error, hasError: true }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    const changed = props.resetKeys?.some((key, index) => !Object.is(key, state.resetKeys?.[index]))
    if (state.hasError && changed) return { error: null, hasError: false, eventId: null, resetKeys: props.resetKeys }
    if (changed) return { resetKeys: props.resetKeys }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const chunkError = isChunkLoadError(error)
    const eventId = captureException(error, {
      mechanism: 'react.error_boundary',
      handled: false,
      level: chunkError ? 'warning' : 'error',
      tags: { boundary: this.props.scope, ...(chunkError ? { kind: 'chunk_load' } : {}) },
      extra: { component_stack: info.componentStack?.split('\n').slice(0, 12).join('\n') },
    })
    this.setState({ eventId })
  }

  reset = () => {
    this.setState({ error: null, hasError: false, eventId: null })
  }

  render() {
    if (this.state.hasError) return this.props.fallback({ error: this.state.error, eventId: this.state.eventId, reset: this.reset })
    return this.props.children
  }
}
