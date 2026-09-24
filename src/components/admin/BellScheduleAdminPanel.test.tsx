import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

    render(<BellScheduleAdminPanel isDemo={false} />)
    await screen.findByRole('option', { name: 'NASH-only custom schedule · NASH' })
    fireEvent.change(screen.getByLabelText('Bell schedule'), { target: { value: nashOnly.id } })
    expect(screen.getByLabelText('NAI')).toBeDisabled()
    expect(screen.getByLabelText('NAI')).not.toBeChecked()
    expect(screen.getByLabelText('NASH')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '25' }))
    fireEvent.change(screen.getByRole('combobox', { name: /^A\/B day$/ }), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign 1 date' }))
    await waitFor(() => expect(data.adminBulkAssignSchoolDays).toHaveBeenCalledWith({
      dates: ['2026-09-25'], campuses: ['NASH'], dayType: 'B', noSchool: false, scheduleId: nashOnly.id,
    }))
  })

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
    expect(screen.queryByLabelText('Bell-schedule Google Doc')).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: /This class ends in/ })).toHaveTextContent('28:00')
    fireEvent.change(screen.getByLabelText('Preview time'), { target: { value: '08:30' } })
    expect(screen.getByLabelText('Preview student class period')).toHaveValue('2')
    expect(screen.getByRole('heading', { name: /This class ends in/ })).toHaveTextContent('35:00')
    expect(screen.getByText(/Ends at 9:05 AM/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Preview student class name'), { target: { value: '' } })
    expect(screen.getByRole('heading', { name: /This class ends in/ })).toBeInTheDocument()
  })
})
