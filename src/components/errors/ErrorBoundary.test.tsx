import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initObservability, resetObservability } from '../../lib/observability/client'
import type { ObservabilityEvent } from '../../lib/observability/types'
import { ErrorBoundary } from './ErrorBoundary'
import { ErrorFallback } from './ErrorFallback'

const events: ObservabilityEvent[] = []

function Crash({ error }: { error: Error }): never {
  throw error
}

beforeEach(() => {
  events.length = 0
  resetObservability()
  initObservability({ release: 'test', environment: 'test', transports: [{ name: 'recording', send: (event) => { events.push(event) } }] })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('reports a render crash and shows a recovery screen with an error reference', () => {
    render(<ErrorBoundary scope="route" fallback={(props) => <ErrorFallback {...props} />}><Crash error={new TypeError('rows is undefined')} /></ErrorBoundary>)

    expect(screen.getByRole('alert')).toHaveTextContent('This page ran into a problem')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ level: 'error', tags: { boundary: 'route' }, exception: { type: 'TypeError', mechanism: { type: 'react.error_boundary', handled: false } } })
    const reference = events[0].event_id.slice(0, 8).toUpperCase()
    expect(screen.getByText(reference)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Report this problem' })).toHaveAttribute('href', `#/report?error=${reference}`)
  })

  it('recovers when the student tries again', async () => {
    function Flaky() {
      const [broken, setBroken] = useState(true)
      return (
        <ErrorBoundary scope="route" fallback={(props) => <ErrorFallback {...props} reset={() => { setBroken(false); props.reset() }} />}>
          {broken ? <Crash error={new Error('first render failed')} /> : <p>Recovered</p>}
        </ErrorBoundary>
      )
    }
    render(<Flaky />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

  it('clears the error when the route changes', () => {
    const { rerender } = render(<ErrorBoundary scope="route" resetKeys={['/a']} fallback={(props) => <ErrorFallback {...props} />}><Crash error={new Error('bad page')} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<ErrorBoundary scope="route" resetKeys={['/b']} fallback={(props) => <ErrorFallback {...props} />}><p>Next page</p></ErrorBoundary>)
    expect(screen.getByText('Next page')).toBeInTheDocument()
  })

  it('offers a reload instead of an error when a deploy left this tab stale', () => {
    render(<ErrorBoundary scope="route" fallback={(props) => <ErrorFallback {...props} />}><Crash error={new TypeError('Failed to fetch dynamically imported module: https://x/assets/HomePage-abc.js')} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('ScheduleShare was updated')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(events[0]).toMatchObject({ level: 'warning', tags: { kind: 'chunk_load' } })
  })
})
