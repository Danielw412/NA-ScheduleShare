import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDialogAccessibility } from './useDialogAccessibility'

function TestDialog({ children, label = 'Test dialog', onClose }: { children?: ReactNode; label?: string; onClose: () => void }) {
  const dialogRef = useDialogAccessibility(true, onClose)
  return <section aria-label={label} ref={dialogRef} role="dialog" tabIndex={-1}>
    <button type="button" onClick={onClose}>Close</button>
    <button type="button">Last action</button>
    {children}
  </section>
}

function Harness() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
    {open ? <TestDialog onClose={() => setOpen(false)} /> : null}
  </>
}

function NestedHarness() {
  const [outerOpen, setOuterOpen] = useState(false)
  const [innerOpen, setInnerOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOuterOpen(true)}>Open outer</button>
    {outerOpen ? <TestDialog label="Outer dialog" onClose={() => setOuterOpen(false)}>
      <button type="button" onClick={() => setInnerOpen(true)}>Open inner</button>
      {innerOpen ? <TestDialog label="Inner dialog" onClose={() => setInnerOpen(false)} /> : null}
    </TestDialog> : null}
  </>
}

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('useDialogAccessibility', () => {
  it('moves and traps focus, closes on Escape, and restores the trigger', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })

    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })

    await user.click(screen.getByRole('button', { name: 'Last action' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('lets only the topmost nested dialog handle keyboard events', async () => {
    const user = userEvent.setup()
    render(<NestedHarness />)

    await user.click(screen.getByRole('button', { name: 'Open outer' }))
    await user.click(screen.getByRole('button', { name: 'Open inner' }))
    expect(screen.getByRole('dialog', { name: 'Inner dialog' })).toBeInTheDocument()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Inner dialog' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).toBeInTheDocument()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Outer dialog' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
})
