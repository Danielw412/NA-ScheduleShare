import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  getHomepageStatistic: vi.fn(),
  createScheduleShareUrl: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({ getHomepageStatistic: mocks.getHomepageStatistic }))
vi.mock('../lib/scheduleShare', () => ({
  createScheduleShareUrl: mocks.createScheduleShareUrl,
  scheduleShareTitle: 'My A/B-Day Schedule | NA ScheduleShare',
}))

function renderPage() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>)
}

function completeSchedule() {
  return Array.from({ length: 9 }, (_, index) => ({
    active: true,
    class: {
      meeting_slots: [
        { day_type: 'A', period_number: index + 1 },
        { day_type: 'B', period_number: index + 1 },
      ],
    },
  }))
}

beforeEach(() => {
  sessionStorage.clear()
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop browser' })
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
  mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
  mocks.getHomepageStatistic.mockResolvedValue(null)
  mocks.createScheduleShareUrl.mockResolvedValue('https://share.example/share/99300000-0000-4000-8000-000000000001')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HomePage hero', () => {
  it('takes a guest directly to the Schedule tab', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Find out who’s in your classes.' })).toBeInTheDocument()
    expect(screen.getByText('Upload a picture of your schedule, find classmates, and compare schedules with friends.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/schedule')
  })

  it('takes an authenticated user directly to the Schedule tab', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
    renderPage()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/schedule')
    expect(screen.getByRole('heading', { name: 'Start your schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Schedule' })).not.toBeInTheDocument()
  })

  it('sends students with a complete schedule to classmates and offers sharing', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
    mocks.useSchedule.mockReturnValue({ enrollments: completeSchedule(), loading: false })
    renderPage()

    expect(screen.getByRole('link', { name: /Find Classmates/ })).toHaveAttribute('href', '/students')
    expect(screen.getByRole('heading', { name: 'Share your schedule with friends' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Share schedule/ }))

    await waitFor(() => expect(mocks.createScheduleShareUrl).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('Schedule link copied.')
  })

  it('uses the native share sheet for complete schedules on mobile devices', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
    mocks.useSchedule.mockReturnValue({ enrollments: completeSchedule(), loading: false })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /Share schedule/ }))

    await waitFor(() => expect(nativeShare).toHaveBeenCalledWith({
      title: 'My A/B-Day Schedule | NA ScheduleShare',
      url: 'https://share.example/share/99300000-0000-4000-8000-000000000001',
    }))
  })

  it('renders only the real statistic returned by the database', async () => {
    mocks.getHomepageStatistic.mockResolvedValue({
      statistic_key: 'class_connections',
      activity_scope: 'total',
      statistic_value: 1240,
      statistic_label: 'class connections found',
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('1,240')).toBeInTheDocument())
    expect(screen.getByText(/class connections found/)).toBeInTheDocument()
  })
})
