import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as scheduleShare from '../lib/scheduleShare'
import { SharedSchedulePage } from './SharedSchedulePage'

const TOKEN = '99300000-0000-4000-8000-000000000001'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/share/${TOKEN}`]}>
      <Routes><Route path="share/:token" element={<SharedSchedulePage />} /></Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function incompleteSchedule() {
  return { loading: false, enrollments: [] }
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ user: null })
  mocks.useSchedule.mockReturnValue(incompleteSchedule())
})

describe('shared schedule page', () => {
  it('renders a signed-out-safe read-only grid including period 9', async () => {
    vi.spyOn(scheduleShare, 'fetchPublicScheduleShare').mockResolvedValue({
      available: true,
      owner_name: 'Bob',
      schedule: [{ day_type: 'A', period_number: 9, course_name: 'Robotics', teacher_last_name: 'Lovelace', academic_term: 'semester_1' }],
    })

    renderPage()

    expect(await screen.findByRole('heading', { name: "Bob's schedule" })).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    expect(screen.getByText('Lovelace')).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /Robotics/i })).toHaveAttribute('data-period', '9')
    expect(screen.queryByRole('button', { name: /Add class/i })).not.toBeInTheDocument()
    expect(screen.queryByText('A read-only A/B-day schedule shared through ScheduleShare.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload My Schedule' })).toHaveAttribute('href', '/schedule?import=1')
    expect(screen.getByRole('link', { name: 'Upload your own schedule' })).toHaveAttribute('href', '/schedule?import=1')
  })

  it('hides the upload callout for an account with a complete schedule', async () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' } })
    mocks.useSchedule.mockReturnValue({
      loading: false,
      enrollments: Array.from({ length: 18 }, (_, index) => ({
        id: `enrollment-${index}`,
        active: true,
        class: { meeting_slots: [{ day_type: index < 9 ? 'A' : 'B', period_number: (index % 9) + 1 }] },
      })),
    })
    vi.spyOn(scheduleShare, 'fetchPublicScheduleShare').mockResolvedValue({
      available: true,
      owner_name: 'Bob',
      schedule: [{ day_type: 'A', period_number: 1, course_name: 'Robotics', teacher_last_name: 'Lovelace', academic_term: 'semester_1' }],
    })

    renderPage()

    await screen.findByRole('heading', { name: "Bob's schedule" })
    expect(screen.queryByRole('link', { name: 'Upload My Schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload your own schedule' })).not.toBeInTheDocument()
  })

  it('shows a clear generic state for an invalid or disabled link', async () => {
    vi.spyOn(scheduleShare, 'fetchPublicScheduleShare').mockResolvedValue({ available: false, owner_name: null, schedule: [] })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'This schedule isn’t available' })).toBeInTheDocument()
    expect(screen.getByText(/invalid, disabled, or no longer available/i)).toBeInTheDocument()
  })
})
