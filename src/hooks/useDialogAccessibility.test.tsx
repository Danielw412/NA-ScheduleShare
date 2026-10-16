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

  it('skips controls hidden inside a closed details element when trapping focus', async () => {
    const user = userEvent.setup()
    render(<TestDialog onClose={() => undefined}><details><summary>More options</summary><button type="button">Hidden action</button></details></TestDialog>)
    screen.getByRole('button', { name: 'Close' }).focus()
    await user.tab()
    await user.tab()
    expect(screen.getByText('More options')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('returns focus to the page content when the opener no longer exists', async () => {
    const user = userEvent.setup()
    function MenuHarness() {
      const [menuOpen, setMenuOpen] = useState(true)
      const [dialogOpen, setDialogOpen] = useState(false)
      return <main id="main-content" tabIndex={-1}>
        {menuOpen ? <button type="button" onClick={() => { setMenuOpen(false); setDialogOpen(true) }}>Menu item</button> : null}
        {dialogOpen ? <TestDialog onClose={() => setDialogOpen(false)} /> : null}
      </main>
    }
    render(<MenuHarness />)
    await user.click(screen.getByRole('button', { name: 'Menu item' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.getElementById('main-content')).toHaveFocus()
  })

  it('returns focus to the opener even when the dialog autofocuses a field', async () => {
    const user = userEvent.setup()
    function AutoFocusDialog({ onClose }: { onClose: () => void }) {
      const dialogRef = useDialogAccessibility(true, onClose)
      return <section aria-label="Auto dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <input aria-label="Search" autoFocus />
        <button type="button" onClick={onClose}>Done</button>
      </section>
    }
    function AutoFocusHarness() {
      const [open, setOpen] = useState(false)
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open search</button>
        {open ? <AutoFocusDialog onClose={() => setOpen(false)} /> : null}
      </>
    }
    render(<AutoFocusHarness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus()
  })

  it('skips summaries of details nested inside a closed details element', async () => {
    const user = userEvent.setup()
    render(<TestDialog onClose={() => undefined}><details><summary>Outer</summary><details><summary>Inner</summary><button type="button">Deep</button></details></details></TestDialog>)
    screen.getByRole('button', { name: 'Last action' }).focus()
    await user.tab()
    expect(screen.getByText('Outer')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
