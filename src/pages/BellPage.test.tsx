import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BellScheduleProvider } from '../features/bell/BellScheduleProvider'
import { easternLocalTime } from '../lib/bellSchedule'
import type { ScheduleEnrollment, SchoolDayContext } from '../lib/domain'
import { BellPage } from './BellPage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  getMyBellScheduleWindow: vi.fn(),
  getGuestBellScheduleWindow: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({
  getMyBellScheduleWindow: mocks.getMyBellScheduleWindow,
  getGuestBellScheduleWindow: mocks.getGuestBellScheduleWindow,
}))

function day(date: string, options: Partial<SchoolDayContext> = {}): SchoolDayContext {
  return {
    date, campus: 'NASH', day_type: 'A', semester: 'semester_1', no_school: false, source: 'default',
    schedule: {
      id: 'regular', schedule_key: 'regular', display_name: 'Regular', campus_scope: 'BOTH', warning_time: '07:24', is_builtin: true, archived_at: null, updated_at: '',
      blocks: [
        { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
        { position: 2, kind: 'class', label: 'Period 2', period_number: 2, start_time: '08:12', end_time: '08:52' },
      ],
    },
    ...options,
  }
}

const enrollment: ScheduleEnrollment = {
  id: 'enrollment', class_id: 'class', student_id: 'student', academic_term: 'full_year', active: true, created_at: '', updated_at: '',
  meeting_slots: [{ day_type: 'B', period_number: 2 }],
  class: { id: 'class', course_name_id: 'course', course_name: 'AP Psychology', teacher_last_name: 'Teacher', default_academic_term: 'full_year', is_double_period: false, meeting_slots: [{ day_type: 'B', period_number: 2 }] },
}

const window = [
  day('2026-08-21'),
  day('2026-08-22', { no_school: true, schedule: null, day_type: null }),
  day('2026-08-23', { no_school: true, schedule: null, day_type: null }),
  day('2026-08-24', { day_type: 'B', schedule: { ...day('x').schedule!, display_name: 'Two-hour delay', warning_time: null } }),
  day('2026-08-25', { no_school: true, schedule: null, day_type: null }),
]

function renderPage() {
  return render(<MemoryRouter><BellScheduleProvider><BellPage /></BellScheduleProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(easternLocalTime('2026-08-21', '07:40'))
  localStorage.clear()
  mocks.useAuth.mockReturnValue({ user: { id: 'student' }, profile: { grade: 11 }, isDemo: false, loading: false })
  mocks.useSchedule.mockReturnValue({ enrollments: [enrollment], loading: false })
  mocks.getMyBellScheduleWindow.mockResolvedValue(window)
  mocks.getGuestBellScheduleWindow.mockResolvedValue(window)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('BellPage', () => {
  it('lists school days, hides closed weekends, and starts on today', async () => {
    renderPage()
    const days = await screen.findByRole('group', { name: 'Choose a day' })
    const buttons = within(days).getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Friday, August 21, A day',
      'Monday, August 24, B day',
      'Tuesday, August 25, no school',
    ])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[0]).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('heading', { level: 2, name: 'Friday, August 21' })).toBeInTheDocument()
    expect(screen.getByText('Warning bell at 7:24 AM')).toBeInTheDocument()
    const timeline = screen.getByRole('list', { name: 'Friday, August 21 bell schedule' })
    expect(within(timeline).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'time')
  })

  it('shows the student’s class in each period of the chosen day', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Monday, August 24, B day' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Monday, August 24' })).toBeInTheDocument()
    expect(screen.getByText('Two-hour delay schedule')).toBeInTheDocument()
    expect(screen.queryByText(/Warning bell/)).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Monday, August 24 bell schedule' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('No class')
    expect(rows[1]).toHaveTextContent('AP Psychology')
    expect(rows[0]).not.toHaveAttribute('aria-current')
  })

  it('explains days without school', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Tuesday, August 25, no school' }))
    expect(screen.getByRole('heading', { name: 'No school' })).toBeInTheDocument()
  })

  it('lets guests switch campus and never shows class names', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isDemo: false, loading: false })
    mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
    renderPage()
    await screen.findByRole('group', { name: 'Choose a day' })
    expect(screen.queryByText('No class')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'NAI' }))
    await waitFor(() => expect(mocks.getGuestBellScheduleWindow).toHaveBeenLastCalledWith('2026-08-21', 21, 'NAI'))
  })

  it('offers a retry when the calendar cannot load', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.getMyBellScheduleWindow.mockRejectedValueOnce(new Error('network'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('The bell schedule didn’t load.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('group', { name: 'Choose a day' })).toBeInTheDocument()
  })
})
