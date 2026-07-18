import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuestAccountPromptProvider } from '../components/auth/GuestAccountPrompt'
import { HomePage } from './HomePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  getHomepageStatistic: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({ getHomepageStatistic: mocks.getHomepageStatistic }))

function renderPage() {
  return render(<MemoryRouter><GuestAccountPromptProvider><HomePage /></GuestAccountPromptProvider></MemoryRouter>)
}

beforeEach(() => {
  sessionStorage.clear()
  mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
  mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
  mocks.getHomepageStatistic.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HomePage hero', () => {
  it('opens registration in a modal for a guest upload', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('heading', { name: 'Find out who’s in your classes.' })).toBeInTheDocument()
    expect(screen.getByText('Upload a picture of your schedule, find classmates, and compare schedules with friends.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Upload My Schedule/ }))
    expect(screen.getByRole('dialog', { name: 'Create an account' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Explore ScheduleShare' })).not.toBeInTheDocument()
  })

  it('takes an authenticated user directly to the Schedule tab', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
    renderPage()
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/schedule')
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
