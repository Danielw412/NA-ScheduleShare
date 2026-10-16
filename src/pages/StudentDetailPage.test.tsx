import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEnrollment } from '../lib/domain'
import { StudentDetailPage } from './StudentDetailPage'

const mocks = vi.hoisted(() => ({
  getVisibleSchedule: vi.fn(),
  searchReportableUsers: vi.fn(),
  searchStudentDirectory: vi.fn(async (): Promise<unknown[]> => []),
  requestScheduleAccess: vi.fn(async () => undefined),
  cancelScheduleAccessRequest: vi.fn(async () => undefined),
}))

const accessChangedEvent = 'scheduleshare:schedule-access-changed'

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' }, isDemo: false }) }))
vi.mock('../lib/supabase/data', () => ({
  getVisibleSchedule: mocks.getVisibleSchedule,
  searchReportableUsers: mocks.searchReportableUsers,
  searchStudentDirectory: mocks.searchStudentDirectory,
  requestScheduleAccess: mocks.requestScheduleAccess,
  cancelScheduleAccessRequest: mocks.cancelScheduleAccessRequest,
  scheduleAccessChangedEvent: 'scheduleshare:schedule-access-changed',
}))
vi.mock('../features/students/useSchoolDayDefaults', () => ({
  useSchoolDayDefaults: () => ({ semester: null, dayType: null, todayDayType: null, todaySemester: null }),
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

function directoryEntry(studentId: string, outgoingRequestPending: boolean) {
  return {
    student_id: studentId,
    full_name: 'Casey',
    grade: 12,
    privacy_setting: 'private',
    shared_class_count: 0,
    can_view_schedule: false,
    they_can_view_yours: 'no_access',
    you_can_view_theirs: 'private',
    outgoing_request_pending: outgoingRequestPending,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.searchStudentDirectory.mockImplementation(async () => [])
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

describe('StudentDetailPage access', () => {
  function renderStudent(state?: unknown) {
    return render(<MemoryRouter initialEntries={[{ pathname: '/students/student-a', state }]}>
      <Routes><Route path="/students/:studentId" element={<StudentDetailPage />} /></Routes>
    </MemoryRouter>)
  }

  it('names the student, explains why the schedule is visible, and offers a report link', async () => {
    mocks.getVisibleSchedule.mockResolvedValue([enrollment('visible', 'student-a')])
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Alex Morgan', grade: 11 }])
    renderStudent({ reportedUser: { student_id: 'student-a', full_name: 'Alex Morgan', grade: 11 }, access: 'shared_class' })

    expect(screen.getByRole('heading', { level: 1, name: 'Alex Morgan' })).toBeInTheDocument()
    expect(screen.getByText('Grade 11')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/students')
    expect(screen.getByRole('link', { name: 'Report user' })).toHaveAttribute('href', '/report')
    expect(await screen.findByText('Course visible')).toBeInTheDocument()
    expect(screen.getByText('You can see this schedule because you share a class.')).toBeInTheDocument()
  })

  it('lets a student request access to a private schedule and cancel the request', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule.mockRejectedValue(new Error('schedule_access_denied'))
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Casey Private', grade: 12 }])
    renderStudent()

    expect(await screen.findByRole('heading', { name: 'This schedule isn’t available' })).toBeInTheDocument()
    expect(await screen.findByText(/access to Casey’s schedule/)).toBeInTheDocument()
    expect(screen.queryByText('Course visible')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Request access' }))
    expect(mocks.requestScheduleAccess).toHaveBeenCalledWith('student-a')
    expect(await screen.findByRole('status')).toHaveTextContent('Request sent.')

    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    expect(mocks.cancelScheduleAccessRequest).toHaveBeenCalledWith('student-a')
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeEnabled()
  })

  it('does not say the student has access while the schedule is still loading', async () => {
    const pending = deferred<ScheduleEnrollment[]>()
    mocks.getVisibleSchedule.mockReturnValue(pending.promise.then(() => { throw new Error('schedule_access_denied') }))
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Casey Private', grade: 12 }])
    renderStudent({ reportedUser: { student_id: 'student-a', full_name: 'Casey Private', grade: 12 }, access: 'shared_class' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading schedule…')
    expect(screen.queryByText('You can see this schedule because you share a class.')).not.toBeInTheDocument()
    expect(screen.queryByText('You have access to this schedule.')).not.toBeInTheDocument()

    await act(async () => { pending.resolve([]); await pending.promise })
    expect(await screen.findByRole('heading', { name: 'This schedule isn’t available' })).toBeInTheDocument()
    expect(screen.queryByText(/You can see this schedule|You have access/)).not.toBeInTheDocument()
  })

  it('shows the schedule in place once the student allows the request', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule
      .mockRejectedValueOnce(new Error('schedule_access_denied'))
      .mockRejectedValueOnce(new Error('schedule_access_denied'))
      .mockResolvedValue([enrollment('approved', 'student-a')])
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Casey Private', grade: 12 }])
    renderStudent()

    await user.click(await screen.findByRole('button', { name: 'Request access' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Request sent.')
    // Sending the request announces an access change; the reload finds it still private.
    act(() => { window.dispatchEvent(new Event(accessChangedEvent)) })
    await waitFor(() => expect(mocks.getVisibleSchedule).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Request sent.')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel request' })).toHaveFocus()

    // Casey allows it: the notifications feed announces the change.
    act(() => { window.dispatchEvent(new Event(accessChangedEvent)) })
    expect(await screen.findByText('Course approved')).toBeInTheDocument()
    expect(mocks.getVisibleSchedule).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('heading', { name: 'This schedule isn’t available' })).not.toBeInTheDocument()
    expect(screen.getByText('You have access to this schedule.')).toBeInTheDocument()
    // Focus was on Cancel request, which is gone; it moves to the schedule.
    expect(screen.getByRole('heading', { name: 'Schedule' })).toHaveFocus()
  })

  it('shows a request sent earlier as already sent', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule.mockRejectedValue(new Error('schedule_access_denied'))
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Casey Private', grade: 12 }])
    mocks.searchStudentDirectory.mockImplementation(async () => [directoryEntry('someone-else', false), directoryEntry('student-a', true)])
    renderStudent()

    expect(await screen.findByRole('heading', { name: 'This schedule isn’t available' })).toBeInTheDocument()
    expect(await screen.findByText('Request sent.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Request sent. Their schedule will show up here once Casey allows it.')
    expect(mocks.searchStudentDirectory).toHaveBeenCalledWith({ query: 'Casey' })
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    expect(mocks.cancelScheduleAccessRequest).toHaveBeenCalledWith('student-a')
    expect(await screen.findByRole('button', { name: 'Request access' })).toHaveFocus()
  })

  it('keeps keyboard focus on the request controls as they change', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule.mockRejectedValue(new Error('schedule_access_denied'))
    mocks.searchReportableUsers.mockResolvedValue([{ student_id: 'student-a', full_name: 'Casey Private', grade: 12 }])
    renderStudent()

    await user.click(await screen.findByRole('button', { name: 'Request access' }))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('Request sent.')
    expect(notice).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel request' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Request access' })).toHaveFocus()
  })

  it('returns focus to the button after a failed cancel', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule.mockRejectedValue(new Error('schedule_access_denied'))
    mocks.searchReportableUsers.mockResolvedValue([])
    mocks.cancelScheduleAccessRequest.mockRejectedValueOnce(new Error('That access request is no longer pending.'))
    renderStudent()

    await user.click(await screen.findByRole('button', { name: 'Request access' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That access request is no longer pending.')
    expect(screen.getByRole('button', { name: 'Cancel request' })).toHaveFocus()
  })

  it('keeps a failed request next to the button', async () => {
    const user = userEvent.setup()
    mocks.getVisibleSchedule.mockRejectedValue(new Error('schedule_access_denied'))
    mocks.searchReportableUsers.mockResolvedValue([])
    mocks.requestScheduleAccess.mockRejectedValueOnce(new Error('That student is no longer available.'))
    renderStudent()

    await user.click(await screen.findByRole('button', { name: 'Request access' }))
    const section = screen.getByRole('heading', { name: 'This schedule isn’t available' }).closest('section') as HTMLElement
    expect(await within(section).findByRole('alert')).toHaveTextContent('That student is no longer available.')
    expect(within(section).getByRole('button', { name: 'Request access' })).toBeEnabled()
    expect(within(section).getByRole('button', { name: 'Request access' })).toHaveFocus()
  })
})
