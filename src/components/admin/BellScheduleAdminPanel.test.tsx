import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { BellScheduleDefinition } from '../../lib/domain'
import { BellScheduleAdminPanel, validateBellScheduleDraft } from './BellScheduleAdminPanel'

function draft(blocks: BellScheduleDefinition['blocks']): BellScheduleDefinition {
  return {
    id: '', schedule_key: 'custom_test', display_name: 'Custom test', campus_scope: 'BOTH', warning_time: '07:24',
    is_builtin: false, archived_at: null, updated_at: '', blocks,
  }
}

afterEach(cleanup)

describe('bell-schedule editor validation', () => {
  it('accepts named blocks and chronological class periods', () => {
    expect(validateBellScheduleDraft(draft([
      { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
      { position: 2, kind: 'non_class', label: 'Assembly', period_number: null, start_time: '08:08', end_time: '08:30' },
      { position: 3, kind: 'class', label: 'Period 2', period_number: 2, start_time: '08:34', end_time: '09:14' },
    ]))).toBeNull()
  })

  it('rejects overlaps and duplicate period numbers before the RPC', () => {
    expect(validateBellScheduleDraft(draft([
      { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
      { position: 2, kind: 'class', label: 'Period 2', period_number: 2, start_time: '08:00', end_time: '08:40' },
    ]))).toMatch(/overlaps/i)
    expect(validateBellScheduleDraft(draft([
      { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
      { position: 2, kind: 'class', label: 'Period 1 again', period_number: 1, start_time: '08:12', end_time: '08:52' },
    ]))).toMatch(/duplicated/i)
  })
})

describe('BellScheduleAdminPanel', () => {
  it('renders the calendar, editor, automation settings, and run history responsively', async () => {
    render(<BellScheduleAdminPanel isDemo />)
    expect(await screen.findByRole('heading', { name: 'School-day assignments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Definitions and blocks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Daily Google Docs detection' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Extraction evidence' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test the next-class card' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View bell schedule' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview now/i })).toBeInTheDocument()
    expect((screen.getByLabelText('Newsletter Google Doc') as HTMLInputElement).value).toContain('docs.google.com')
  })

  it('supports custom schedules and accessible add/reorder/remove controls', async () => {
    const user = userEvent.setup()
    render(<BellScheduleAdminPanel isDemo />)
    await user.click(await screen.findByRole('button', { name: /Custom/i }))
    expect(screen.getByDisplayValue('Custom schedule')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add block/i }))
    expect(screen.getByLabelText('Block 2 label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Move Custom block up/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove Custom block/i })).toBeInTheDocument()
  })

  it('updates the exact homepage preview from manual date and time controls', async () => {
    render(<BellScheduleAdminPanel isDemo />)
    await screen.findByRole('heading', { name: 'Test the next-class card' })
    fireEvent.change(screen.getByLabelText('Preview date'), { target: { value: '2026-08-24' } })
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '07:40' } })
    expect(screen.getByRole('heading', { name: /Time until AP Psychology is over/ })).toHaveTextContent('28:00')
    fireEvent.change(screen.getByLabelText('Preview student class name'), { target: { value: '' } })
    expect(screen.getByRole('heading', { name: /Time until next class/ })).toBeInTheDocument()
  })
})
