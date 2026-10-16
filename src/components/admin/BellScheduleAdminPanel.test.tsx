import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoBellScheduleWindow } from '../../lib/bellSchedule'
import type { BellScheduleDefinition, BellScheduleSettings } from '../../lib/domain'
import * as data from '../../lib/supabase/data'
import { BellScheduleAdminPanel, validateBellScheduleDraft } from './BellScheduleAdminPanel'

vi.mock('../../lib/supabase/data', () => ({
  adminArchiveBellSchedule: vi.fn(),
  adminBulkAssignSchoolDays: vi.fn(),
  adminClearSchoolDayOverrides: vi.fn(),
  adminGetBellScheduleSettings: vi.fn(),
  adminListBellScheduleSyncRuns: vi.fn(),
  adminListBellSchedules: vi.fn(),
  adminListSchoolDays: vi.fn(),
  adminSaveBellSchedule: vi.fn(),
  adminUnlockSchoolDayOverrides: vi.fn(),
  adminUpdateBellScheduleSettings: vi.fn(),
  invokeBellScheduleSync: vi.fn(),
}))

function draft(blocks: BellScheduleDefinition['blocks']): BellScheduleDefinition {
  return {
    id: '', schedule_key: 'custom_test', display_name: 'Custom test', campus_scope: 'BOTH', warning_time: '07:24',
    is_builtin: false, archived_at: null, updated_at: '', blocks,
  }
}

function mockLoadedSchedules(schedules: BellScheduleDefinition[]) {
  vi.mocked(data.adminListBellSchedules).mockResolvedValue(schedules)
  vi.mocked(data.adminListSchoolDays).mockResolvedValue([])
  vi.mocked(data.adminGetBellScheduleSettings).mockResolvedValue({
    school_year_start: '2026-08-18', semester_2_start: '2027-01-12', school_year_end: '2027-05-28',
    default_schedule_id: schedules[0].id, school_timezone: 'America/New_York', sync_enabled: false,
    sync_time: '06:00', newsletter_document_url: '', updated_at: '',
  })
  vi.mocked(data.adminListBellScheduleSyncRuns).mockResolvedValue([])
}

// The Balanced-homepage preview strip is a router link.
function renderPanel(isDemo: boolean) {
  return render(<MemoryRouter><BellScheduleAdminPanel isDemo={isDemo} /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

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
  it('assigns a NASH-only schedule to NASH without including the default NAI selection', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T16:00:00Z'))
    const regular = { ...draft([{ position: 1, kind: 'class' as const, label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' }]), id: 'regular', display_name: 'Regular' }
    const nashOnly = { ...regular, id: 'nash-only', display_name: 'NASH-only custom schedule', campus_scope: 'NASH' as const }
    const settings: BellScheduleSettings = {
      school_year_start: '2026-08-18', semester_2_start: '2027-01-12', school_year_end: '2027-05-28',
      default_schedule_id: regular.id, school_timezone: 'America/New_York', sync_enabled: false,
      sync_time: '06:00', newsletter_document_url: '', updated_at: '',
    }
    vi.mocked(data.adminListBellSchedules).mockResolvedValue([regular, nashOnly])
    vi.mocked(data.adminListSchoolDays).mockResolvedValue([])
    vi.mocked(data.adminGetBellScheduleSettings).mockResolvedValue(settings)
    vi.mocked(data.adminListBellScheduleSyncRuns).mockResolvedValue([])
    vi.mocked(data.adminBulkAssignSchoolDays).mockResolvedValue(1)

    renderPanel(false)
    await screen.findByRole('option', { name: 'NASH-only custom schedule (NASH only)' })
    fireEvent.change(screen.getByLabelText('Bell schedule'), { target: { value: nashOnly.id } })
    expect(screen.getByLabelText('NAI')).toBeDisabled()
    expect(screen.getByLabelText('NAI')).not.toBeChecked()
    expect(screen.getByLabelText('NASH')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /^Friday, September 25/ }))
    expect(screen.getByRole('button', { name: /^Friday, September 25/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 day selected')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: /^A\/B day$/ }), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign 1 date' }))
    await waitFor(() => expect(data.adminBulkAssignSchoolDays).toHaveBeenCalledWith({
      dates: ['2026-09-25'], campuses: ['NASH'], dayType: 'B', noSchool: false, scheduleId: nashOnly.id,
    }))
  })

  it('renders the calendar, editor, homepage preview, sync settings, and run history', async () => {
    renderPanel(true)
    expect(await screen.findByRole('heading', { name: 'School-day assignments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bell times' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Newsletter sync' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sync history' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Homepage preview' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Preview bell times' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview now/i })).toBeInTheDocument()
    expect((screen.getByLabelText('Newsletter Google Doc') as HTMLInputElement).value).toContain('docs.google.com')
    expect(screen.queryByLabelText('Bell-schedule Google Doc')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View bell schedule' })).not.toBeInTheDocument()
  })

  it('archives a saved custom schedule only after the confirmation dialog', async () => {
    const user = userEvent.setup()
    const regular = { ...draft([{ position: 1, kind: 'class' as const, label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' }]), id: 'regular', display_name: 'Regular', is_builtin: true }
    const custom = { ...regular, id: 'custom-1', display_name: 'Assembly day', schedule_key: 'assembly_day', is_builtin: false }
    vi.mocked(data.adminListBellSchedules).mockResolvedValue([custom, regular])
    vi.mocked(data.adminListSchoolDays).mockResolvedValue([])
    vi.mocked(data.adminGetBellScheduleSettings).mockResolvedValue({
      school_year_start: '2026-08-18', semester_2_start: '2027-01-12', school_year_end: '2027-05-28',
      default_schedule_id: regular.id, school_timezone: 'America/New_York', sync_enabled: false,
      sync_time: '06:00', newsletter_document_url: '', updated_at: '',
    })
    vi.mocked(data.adminListBellScheduleSyncRuns).mockResolvedValue([])
    vi.mocked(data.adminArchiveBellSchedule).mockResolvedValue(undefined)

    renderPanel(false)
    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive Assembly day?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(data.adminArchiveBellSchedule).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Archive Assembly day?' })).getByRole('button', { name: 'Archive schedule' }))
    await waitFor(() => expect(data.adminArchiveBellSchedule).toHaveBeenCalledWith('custom-1'))
  })

  it('shows a validation error next to the editor instead of saving an invalid draft', async () => {
    const user = userEvent.setup()
    renderPanel(true)
    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Save bell times' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a schedule name up to 100 characters.')
    expect(data.adminSaveBellSchedule).not.toHaveBeenCalled()
  })

  it('supports custom schedules and accessible add/reorder/remove controls', async () => {
    const user = userEvent.setup()
    renderPanel(true)
    await user.click(await screen.findByRole('button', { name: 'New custom schedule' }))
    expect(screen.getByDisplayValue('Custom schedule')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add block/i }))
    expect(screen.getByLabelText('Block 2 label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Move Custom block up/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove Custom block/i })).toBeInTheDocument()
  })

  it('drives the homepage now board and timeline from the manual date and time controls', async () => {
    // Real (non-demo) loading with an empty calendar keeps the DOM small and the test fast.
    mockLoadedSchedules([demoBellScheduleWindow('2026-08-18', 1)[0].schedule as BellScheduleDefinition])
    renderPanel(false)
    await screen.findByText('Homepage preview')
    fireEvent.change(screen.getByLabelText('Preview date'), { target: { value: '2026-08-24' } })
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '07:40' } })
    const board = () => document.querySelector('.now-board') as HTMLElement
    expect(within(board()).getByRole('heading', { name: 'Period 1' })).toBeInTheDocument()
    expect(within(board()).getByText('28:00')).toBeInTheDocument()
    expect(within(board()).getByText('AP Psychology')).toBeInTheDocument()
    const timeline = document.querySelector('ol[aria-label="Preview bell times"]') as HTMLElement
    expect(timeline.querySelector('[aria-current="time"]')).toHaveTextContent(/Period 1.*AP Psychology/)

    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '08:30' } })
    expect(screen.getByLabelText('Preview student class period')).toHaveValue('2')
    expect(within(board()).getByRole('heading', { name: 'Period 2' })).toBeInTheDocument()
    expect(within(board()).getByText('35:00')).toBeInTheDocument()
    expect(within(board()).getByText(/Ends at 9:05 AM/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Preview student class name'), { target: { value: '' } })
    expect(within(board()).getByRole('heading', { name: 'Period 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Preview no school'))
    expect(within(board()).getByRole('heading', { name: 'No school today' })).toBeInTheDocument()
    expect(within(board()).getByText(/Next school day is tomorrow/)).toBeInTheDocument()
  }, 15_000)

  it('shows the student’s own next class before school, like the homepage, in both homepage layouts', async () => {
    mockLoadedSchedules([demoBellScheduleWindow('2026-08-18', 1)[0].schedule as BellScheduleDefinition])
    renderPanel(false)
    await screen.findByText('Homepage preview')
    fireEvent.change(screen.getByLabelText('Preview date'), { target: { value: '2026-08-24' } })
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Preview student class period'), { target: { value: '3' } })
    const board = document.querySelector('.now-board') as HTMLElement
    expect(within(board).getByRole('heading', { name: 'Before school' })).toBeInTheDocument()
    const personal = board.querySelector('.now-board-next.is-personal') as HTMLElement
    expect(personal).not.toBeNull()
    expect(personal).toHaveTextContent('Your next class')
    expect(personal).toHaveTextContent('AP Psychology')
    expect(personal).toHaveTextContent('Starts at 9:09 AM')

    // The Balanced layout's one-line strip is shown too, but can't navigate away from unsaved edits.
    const strip = document.querySelector('.admin-bell-stage .now-strip') as HTMLElement
    expect(strip).toHaveTextContent('AP Psychology starts at 9:09 AM')
    expect(strip.closest('[inert]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Preview student class period'), { target: { value: '' } })
    expect(board.querySelector('.now-board-next.is-personal')).toBeNull()
  }, 15_000)

  it('marks sync-set and special-schedule days on phone-width cells and spells out the tapped day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-16T14:00:00Z'))
    renderPanel(true)
    const day = await screen.findByRole('button', { name: /^Wednesday, October 21\./ })
    const compact = day.querySelector('.admin-bell-compact') as HTMLElement
    expect(compact).toHaveClass('is-ai')
    expect(compact.querySelector('.admin-bell-special-mark')).not.toBeNull()
    const regularDay = screen.getByRole('button', { name: /^Thursday, October 15\./ })
    expect(regularDay.querySelector('.admin-bell-compact')).toHaveClass('is-default')
    expect(regularDay.querySelector('.admin-bell-special-mark')).toBeNull()
    expect(screen.getByText('Not the default bell schedule')).toBeInTheDocument()

    fireEvent.click(day)
    const detail = document.querySelector('.admin-bell-day-detail') as HTMLElement
    expect(detail).toHaveTextContent('Wednesday, October 21')
    expect(detail).toHaveTextContent('NAI')
    expect(detail).toHaveTextContent('Two hour delay, set by the newsletter sync')
  })
})
