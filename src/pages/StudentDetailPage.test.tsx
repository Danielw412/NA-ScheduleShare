import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEnrollment } from '../lib/domain'
import { StudentDetailPage } from './StudentDetailPage'

const mocks = vi.hoisted(() => ({
  getVisibleSchedule: vi.fn(),
  searchReportableUsers: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' }, isDemo: false }) }))
vi.mock('../lib/supabase/data', () => ({
  getVisibleSchedule: mocks.getVisibleSchedule,
  searchReportableUsers: mocks.searchReportableUsers,
}))
vi.mock('../components/schedule/TermSelector', () => ({ TermSelector: () => <div /> }))
vi.mock('../components/schedule/ScheduleGrid', () => ({
  ScheduleGrid: ({ enrollments }: { enrollments: ScheduleEnrollment[] }) => <div>{enrollments.map((item) => <span key={item.id}>{item.class.course_name}</span>)}</div>,
}))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: () => <span /> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function enrollment(id: string, studentId: string): ScheduleEnrollment {
  const timestamp = '2026-07-30T12:00:00.000Z'
  return {
    id,
    class_id: `class-${id}`,
    student_id: studentId,
    academic_term: 'full_year',
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
    meeting_slots: [{ day_type: 'A', period_number: 1 }],
    class: {
      id: `class-${id}`,
      course_name_id: `course-${id}`,
      course_name: `Course ${id}`,
      teacher_last_name: 'Teacher',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 1 }],
    },
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StudentDetailPage request isolation', () => {
  it('does not render a previous student schedule after route navigation', async () => {
    const user = userEvent.setup()
    const first = deferred<ScheduleEnrollment[]>()
    const second = deferred<ScheduleEnrollment[]>()
    mocks.getVisibleSchedule.mockImplementation((studentId: string) => studentId === 'student-a' ? first.promise : second.promise)
    mocks.searchReportableUsers.mockImplementation(async (_query: string, studentId: string) => [{ student_id: studentId, full_name: studentId, grade: 11 }])
    render(<MemoryRouter initialEntries={['/students/student-a']}>
      <Link to="/students/student-b">Next student</Link>
      <Routes><Route path="/students/:studentId" element={<StudentDetailPage />} /></Routes>
    </MemoryRouter>)

    await waitFor(() => expect(mocks.getVisibleSchedule).toHaveBeenCalledWith('student-a'))
    await user.click(screen.getByRole('link', { name: 'Next student' }))
    await waitFor(() => expect(mocks.getVisibleSchedule).toHaveBeenCalledWith('student-b'))

    await act(async () => { second.resolve([enrollment('current', 'student-b')]); await second.promise })
    expect(await screen.findByText('Course current')).toBeInTheDocument()

    await act(async () => { first.resolve([enrollment('stale', 'student-a')]); await first.promise })
    expect(screen.queryByText('Course stale')).not.toBeInTheDocument()
    expect(screen.getByText('Course current')).toBeInTheDocument()
  })
})
