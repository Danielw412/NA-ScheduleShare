import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  mocks.getClassMembers.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ClassesPage organization', () => {
  it('lists active classes first and removes them from Other Classes', () => {
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)
    expect(mocks.useClassSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }), expect.any(Object))
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

  it('groups same-name sections across teachers and reveals their periods on demand', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      loading: false,
      error: null,
      results: [
        { ...ownClass, score: 100 },
        { ...otherClass, id: 'biology-spak', course_name: 'AP Biology', teacher_last_name: 'Spak', meeting_slots: [{ day_type: 'A', period_number: 2 }] },
        { ...otherClass, id: 'biology-allen', course_name: 'AP Biology', teacher_last_name: 'Allen', meeting_slots: [{ day_type: 'B', period_number: 8 }, { day_type: 'B', period_number: 9 }] },
      ],
    })
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)

    const group = screen.getByRole('button', { name: /AP Biology\s*2 periods/ })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Spak')).not.toBeInTheDocument()

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Spak')).toBeInTheDocument()
    expect(screen.getByText('Allen')).toBeInTheDocument()
    expect(screen.getByText('B P8 · B P9')).toBeInTheDocument()
  })

  it('allows the active class group to collapse after a period is selected', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      loading: false,
      error: null,
      results: [
        { ...ownClass, score: 100 },
        { ...otherClass, id: 'biology-spak', course_name: 'AP Biology', teacher_last_name: 'Spak' },
        { ...otherClass, id: 'biology-allen', course_name: 'AP Biology', teacher_last_name: 'Allen' },
      ],
    })
    render(<MemoryRouter initialEntries={['/classes/biology-spak']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    const group = await screen.findByRole('button', { name: /AP Biology\s*2 periods/ })
    const groupSection = group.closest('.course-class-group') as HTMLElement
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(within(groupSection).getByText('Spak')).toBeInTheDocument()

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(within(groupSection).queryByText('Spak')).not.toBeInTheDocument()
  })

  it('shows real class search results but keeps rosters locked for logged-out visitors', () => {
    mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)
    expect(screen.queryByRole('heading', { name: 'Your Classes' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Other Chemistry')).not.toHaveLength(0)
    expect(screen.getByText(/Create an account and add your schedule to see who is in this class/)).toBeInTheDocument()
    expect(mocks.getClassMembers).not.toHaveBeenCalled()
  })

  it('opens the compact filters, shows removable chips, and clears them', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)

    const filterToggle = screen.getByRole('button', { name: 'Filters' })
    await user.click(filterToggle)
    expect(filterToggle).toHaveAttribute('aria-expanded', 'true')

    await user.selectOptions(screen.getByLabelText('Day'), 'A')
    await user.selectOptions(screen.getByLabelText('Period'), '2')
    expect(screen.getByRole('button', { name: /A Day/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Period 2/ })).toBeInTheDocument()
    expect(mocks.useClassSearch).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: 'A', period: 2 }), expect.any(Object))

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByLabelText('Active class filters')).not.toBeInTheDocument()
    expect(mocks.useClassSearch).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: undefined, period: undefined }), expect.any(Object))
  })
})
