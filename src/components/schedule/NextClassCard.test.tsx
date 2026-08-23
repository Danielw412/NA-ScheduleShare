import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEnrollment, SchoolDayContext } from '../../lib/domain'
import { easternLocalTime } from '../../lib/bellSchedule'
import { NextClassCard } from './NextClassCard'

const mocks = vi.hoisted(() => ({ getMyBellScheduleWindow: vi.fn() }))
vi.mock('../../lib/supabase/data', () => ({ getMyBellScheduleWindow: mocks.getMyBellScheduleWindow }))

function enrollment(name = 'AP Psychology'): ScheduleEnrollment {
  return {
    id: 'enrollment', class_id: 'class', student_id: 'student', academic_term: 'full_year', active: true,
    created_at: '', updated_at: '', meeting_slots: [{ day_type: 'A', period_number: 1 }],
    class: { id: 'class', course_name_id: 'course', course_name: name, teacher_last_name: 'Teacher', default_academic_term: 'full_year', is_double_period: false, meeting_slots: [{ day_type: 'A', period_number: 1 }] },
  }
}

function schoolDay(): SchoolDayContext {
  return {
    date: '2026-08-24', campus: 'NASH', day_type: 'A', semester: 'semester_1', no_school: false, source: 'default',
    schedule: {
      id: 'regular', schedule_key: 'regular', display_name: 'Regular', campus_scope: 'BOTH', warning_time: '07:24', is_builtin: true, archived_at: null, updated_at: '',
      blocks: [{ position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' }],
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(easternLocalTime('2026-08-24', '07:30'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  mocks.getMyBellScheduleWindow.mockResolvedValue([schoolDay()])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('NextClassCard', () => {
  it('shows occupied course copy, exact end time, and accessible progress', async () => {
    render(<NextClassCard enrollments={[enrollment()]} isDemo={false} campus="NASH" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: /Time until AP Psychology is over/ })).toBeInTheDocument())
    expect(screen.getByText(/Ends at 8:08 AM/)).toBeInTheDocument()
    const progress = screen.getByRole('progressbar', { name: 'Current block progress' })
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '100')
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('names the current non-class block and counts down to its end', async () => {
    const day = schoolDay()
    day.schedule!.blocks = [{ position: 1, kind: 'non_class', label: 'Homeroom', period_number: null, start_time: '07:28', end_time: '08:08' }]
    mocks.getMyBellScheduleWindow.mockResolvedValue([day])
    render(<NextClassCard enrollments={[]} isDemo={false} campus="NASH" />)
    expect(await screen.findByRole('heading', { name: /Time until Homeroom is over/ })).toBeInTheDocument()
    expect(screen.getByText(/Ends at 8:08 AM/)).toBeInTheDocument()
  })

  it('opens the entire current-day bell schedule in an accessible dialog', async () => {
    render(<NextClassCard enrollments={[enrollment()]} isDemo={false} campus="NASH" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View bell schedule' }))
    const dialog = screen.getByRole('dialog', { name: 'Regular' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Warning bell at 7:24 AM')).toBeInTheDocument()
    expect(screen.getByText('Period 1')).toBeInTheDocument()
    expect(screen.queryByText('Class period')).not.toBeInTheDocument()
    expect(screen.queryByText('School block')).not.toBeInTheDocument()
    expect(screen.getByText('Now')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close bell schedule' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the next class day in the dialog when the selected day is closed', async () => {
    const nextDay = schoolDay()
    nextDay.date = '2026-08-25'
    mocks.getMyBellScheduleWindow.mockResolvedValue([
      { ...schoolDay(), no_school: true, schedule: null, day_type: null },
      nextDay,
    ])
    render(<NextClassCard enrollments={[enrollment()]} isDemo={false} campus="NASH" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View bell schedule' }))
    expect(screen.getByRole('dialog', { name: 'Regular' })).toHaveTextContent('Tuesday, Aug 25')
  })

  it('falls back to generic copy when the reserved single line overflows', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900)
    render(<NextClassCard enrollments={[enrollment('A Very Long Advanced Placement Psychology and Behavioral Science Course')]} isDemo={false} campus="NASH" />)
    await waitFor(() => expect(screen.getByText('Time until next class:')).toBeInTheDocument())
    expect(screen.getByRole('heading')).toHaveTextContent('Time until next class:')
    expect(screen.getByRole('heading')).not.toHaveTextContent('A Very Long')
  })

  it('pauses the one-second timer in a hidden tab and recomputes immediately when visible', async () => {
    render(<NextClassCard enrollments={[enrollment()]} isDemo={false} campus="NASH" />)
    await screen.findByText('38:00')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    vi.setSystemTime(easternLocalTime('2026-08-24', '07:31'))
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(screen.getByText('38:00')).toBeInTheDocument()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByText('36:57')).toBeInTheDocument()
  })

  it('shows a safe retry state when the bounded schedule RPC fails', async () => {
    mocks.getMyBellScheduleWindow.mockRejectedValue(new Error('network'))
    render(<NextClassCard enrollments={[]} isDemo={false} campus="NAI" />)
    expect(await screen.findByRole('heading', { name: 'Next class unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry next class' })).toBeInTheDocument()
  })
})
