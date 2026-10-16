import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { easternLocalTime } from '../../lib/bellSchedule'
import type { SchoolDayContext } from '../../lib/domain'
import { BellNowIndicator } from './BellNowIndicator'

const mocks = vi.hoisted(() => ({ useBellSchedule: vi.fn(), retry: vi.fn() }))
vi.mock('../../features/bell/BellScheduleProvider', () => ({ useBellSchedule: mocks.useBellSchedule }))

const today: SchoolDayContext = {
  date: '2026-08-24', campus: 'NASH', day_type: 'A', semester: 'semester_1', no_school: false, source: 'default',
  schedule: {
    id: 'regular', schedule_key: 'regular', display_name: 'Regular', campus_scope: 'BOTH', warning_time: null, is_builtin: true, archived_at: null, updated_at: '',
    blocks: [
      { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
      { position: 2, kind: 'non_class', label: 'Lunch', period_number: null, start_time: '08:12', end_time: '08:52' },
    ],
  },
}

function renderIndicator(variant: 'pill' | 'sidebar') {
  return render(<MemoryRouter><BellNowIndicator variant={variant} /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(easternLocalTime('2026-08-24', '07:48'))
  mocks.useBellSchedule.mockReturnValue({ days: [today], status: 'ready', retry: mocks.retry })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('BellNowIndicator', () => {
  it('summarizes the current period for the mobile pill and links to the bell schedule', () => {
    renderIndicator('pill')
    const link = screen.getByRole('link', { name: 'Period 1. 20:00 left. Ends at 8:08 AM. Open bell schedule' })
    expect(link).toHaveAttribute('href', '/bell')
    expect(link).toHaveTextContent('1')
    expect(link).toHaveTextContent('20:00')
  })

  it('shows the countdown to the next bell during passing time in the sidebar', () => {
    vi.setSystemTime(easternLocalTime('2026-08-24', '08:10'))
    renderIndicator('sidebar')
    const link = screen.getByRole('link', { name: /Passing time\. 2:00 until Lunch\. Lunch starts at 8:12 AM/ })
    expect(link).toHaveTextContent('A day')
    expect(link).toHaveTextContent('Right now')
  })

  it('points to the next school day once school is out', () => {
    vi.setSystemTime(easternLocalTime('2026-08-24', '15:00'))
    mocks.useBellSchedule.mockReturnValue({ days: [today, { ...today, date: '2026-08-25' }], status: 'ready', retry: mocks.retry })
    renderIndicator('sidebar')
    expect(screen.getByRole('link', { name: /School’s out\. Next school day is tomorrow, starting at 7:28 AM/ })).toHaveTextContent('Up next')
  })

  it('stays out of the way when no school days are scheduled', () => {
    mocks.useBellSchedule.mockReturnValue({ days: [], status: 'ready', retry: mocks.retry })
    const { container } = renderIndicator('pill')
    expect(container).toBeEmptyDOMElement()
  })

  it('lets the student retry when the calendar fails to load', async () => {
    mocks.useBellSchedule.mockReturnValue({ days: [], status: 'error', retry: mocks.retry })
    renderIndicator('pill')
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Bell schedule unavailable. Try again' }))
    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })

  it('uses a date instead of a weekday when the next school day is more than a week away', () => {
    vi.setSystemTime(easternLocalTime('2026-12-23', '10:00'))
    mocks.useBellSchedule.mockReturnValue({ days: [{ ...today, date: '2027-01-04' }], status: 'ready', retry: mocks.retry })
    renderIndicator('pill')
    expect(screen.getByRole('link', { name: /Next school day is Monday, January 4/ })).toHaveTextContent('Jan 4')
  })
})
