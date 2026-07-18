import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassesPage } from './ClassesPage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  useClassSearch: vi.fn(),
  getClassMembers: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../hooks/useClassSearch', () => ({ useClassSearch: mocks.useClassSearch }))
vi.mock('../lib/supabase/data', () => ({ searchClasses: vi.fn(), searchGuestClasses: vi.fn(), getClassMembers: mocks.getClassMembers }))

const ownClass = {
  id: 'class-own',
  course_name_id: 'course-own',
  course_name: 'My Biology',
  teacher_last_name: 'Green',
  default_academic_term: 'full_year' as const,
  is_double_period: false,
  meeting_slots: [{ day_type: 'A' as const, period_number: 1 }],
}

const otherClass = {
  id: 'class-other',
  course_name_id: 'course-other',
  course_name: 'Other Chemistry',
  teacher_last_name: 'Blue',
  default_academic_term: 'full_year' as const,
  is_double_period: false,
  meeting_slots: [{ day_type: 'B' as const, period_number: 2 }],
  score: 90,
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
  mocks.useSchedule.mockReturnValue({
    loading: false,
    enrollments: [{ id: 'enrollment-1', active: true, class: ownClass }],
  })
  mocks.useClassSearch.mockReturnValue({ loading: false, error: null, results: [{ ...ownClass, score: 100 }, otherClass] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ClassesPage organization', () => {
  it('lists active classes first and removes them from Other Classes', () => {
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Your Classes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other Classes' })).toBeInTheDocument()
    expect(screen.getAllByText('My Biology')).toHaveLength(1)
    expect(screen.getAllByText('Other Chemistry')).not.toHaveLength(0)
  })

  it('shows the upload prompt when the student has no classes', () => {
    mocks.useSchedule.mockReturnValue({ loading: false, enrollments: [] })
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)
    expect(screen.getByText('You have not joined any classes yet. Upload your schedule to find and join your classes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload Schedule' })).toHaveAttribute('href', '/schedule?import=1')
  })

  it('shows real class search results but keeps rosters locked for logged-out visitors', () => {
    mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)
    expect(screen.queryByRole('heading', { name: 'Your Classes' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Other Chemistry')).not.toHaveLength(0)
    expect(screen.getByText(/Create an account and add your schedule to see who is in this class/)).toBeInTheDocument()
    expect(mocks.getClassMembers).not.toHaveBeenCalled()
  })
})
