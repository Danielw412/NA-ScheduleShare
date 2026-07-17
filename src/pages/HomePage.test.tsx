import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useGuestAccess: vi.fn(),
  useSchedule: vi.fn(),
  getHomepageStatistic: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../features/guest/GuestAccessContext', () => ({ useGuestAccess: mocks.useGuestAccess }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({ getHomepageStatistic: mocks.getHomepageStatistic }))

function renderPage() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>)
}

beforeEach(() => {
  sessionStorage.clear()
  mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
  mocks.useGuestAccess.mockReturnValue({ explorationEnabled: true })
  mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
  mocks.getHomepageStatistic.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HomePage hero', () => {
  it('opens registration for a guest upload and keeps exploration public without showing the schedule preview', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Find out who’s in your classes.' })).toBeInTheDocument()
    expect(screen.getByText('Upload a picture of your schedule, find classmates, and compare schedules with friends.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/auth?mode=sign-up&next=/schedule')
    expect(screen.getByRole('link', { name: 'Explore ScheduleShare' })).toHaveAttribute('href', '/students')
    expect(screen.queryByLabelText('Schedule summary')).not.toBeInTheDocument()
  })

  it('shows only the upload action when guest exploration is disabled', () => {
    mocks.useGuestAccess.mockReturnValue({ explorationEnabled: false })
    renderPage()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Explore ScheduleShare' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Schedule summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Major features')).not.toBeInTheDocument()
  })

  it('takes an authenticated user directly to the Schedule tab and shows schedule progress', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
    renderPage()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/schedule')
    expect(screen.getByLabelText('Schedule summary')).toBeInTheDocument()
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
