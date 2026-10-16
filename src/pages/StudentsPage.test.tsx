import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentsPage } from './StudentsPage'

const mocks = vi.hoisted(() => ({
  searchStudentDirectory: vi.fn(),
  allowScheduleAccess: vi.fn(async () => undefined),
  removeScheduleAccess: vi.fn(async () => undefined),
  requestScheduleAccess: vi.fn(async () => undefined),
  cancelScheduleAccessRequest: vi.fn(async () => undefined),
  getClassmates: vi.fn(),
  markStudentsVisited: vi.fn(async () => undefined),
}))

vi.mock('../components/auth/DiscoveryGate', () => ({ DiscoveryGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false, markStudentsVisited: mocks.markStudentsVisited }) }))
vi.mock('../lib/supabase/data', () => ({
  searchStudentDirectory: mocks.searchStudentDirectory,
  allowScheduleAccess: mocks.allowScheduleAccess,
  removeScheduleAccess: mocks.removeScheduleAccess,
  requestScheduleAccess: mocks.requestScheduleAccess,
  cancelScheduleAccessRequest: mocks.cancelScheduleAccessRequest,
  getClassmates: mocks.getClassmates,
  scheduleAccessChangedEvent: 'scheduleshare:schedule-access-changed',
}))

beforeEach(() => {
  mocks.getClassmates.mockResolvedValue([
    { student_id: 'classmate-1', full_name: 'Taylor', grade: 11, privacy_setting: 'classmates', shared_course_names: ['Biology'], can_view_schedule: true },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(<ToastProvider><MemoryRouter><StudentsPage /></MemoryRouter></ToastProvider>)
}

describe('StudentsPage schedule access', () => {
  it('records the first visit to the Students tab', async () => {
    renderPage()

    await waitFor(() => expect(mocks.markStudentsVisited).toHaveBeenCalled())
  })

  it('defaults to classmates and keeps directory search in All students', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('radio', { name: 'Classmates' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'All students' })).not.toBeChecked()
    expect(await screen.findByText('Taylor')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Student name')).not.toBeInTheDocument()

    mocks.searchStudentDirectory.mockResolvedValue([])
    await user.click(screen.getByRole('radio', { name: 'All students' }))
    expect(screen.getByPlaceholderText('Student name')).toBeInTheDocument()
  })

  it('shows both directions of access and only relevant actions', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
      { student_id: 'public-student', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true, they_can_view_yours: 'shared_class', you_can_view_theirs: 'everyone_allowed', outgoing_request_pending: false },
    ])

    renderPage()
    await user.click(screen.getByRole('radio', { name: 'All students' }))

    expect(await screen.findByText('Jordan')).toBeInTheDocument()
    const privateCard = screen.getByText('Jordan').closest('li')
    expect(privateCard).not.toBeNull()
    expect(within(privateCard!).getByText('No access')).toBeInTheDocument()
    expect(within(privateCard!).getByText('Private')).toBeInTheDocument()
    expect(within(privateCard!).getByRole('button', { name: 'Allow access' })).toBeInTheDocument()
    expect(within(privateCard!).getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan').closest('a')).toHaveAttribute('href', '/students/public-student')
    const publicCard = screen.getByText('Alex Morgan').closest('li')
    expect(within(publicCard!).getByText('Shared class')).toBeInTheDocument()
    expect(within(publicCard!).getByText('Everyone allowed')).toBeInTheDocument()
    expect(within(publicCard!).queryByRole('button', { name: /access/i })).not.toBeInTheDocument()
  })

  it('allows, requests, and cancels access with success and disabled states', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
    ])
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'All students' }))

    await user.click(await screen.findByRole('button', { name: 'Allow access' }))
    expect(mocks.allowScheduleAccess).toHaveBeenCalledWith('private-student')
    expect(await screen.findByText('Approved by you')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Jordan can now view your schedule')

    await user.click(screen.getByRole('button', { name: 'Request access' }))
    expect(mocks.requestScheduleAccess).toHaveBeenCalledWith('private-student')
    expect(await screen.findByText('Access requested')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(mocks.cancelScheduleAccessRequest).toHaveBeenCalledWith('private-student'))
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('keeps search visible while secondary filters collapse and clear as chips', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([])
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'All students' }))

    expect(screen.getByPlaceholderText('Student name')).toBeInTheDocument()
    const filterToggle = screen.getByRole('button', { name: 'Filters' })
    await user.click(filterToggle)
    expect(filterToggle).toHaveAttribute('aria-expanded', 'true')

    await user.selectOptions(screen.getByLabelText('Grade'), '11')
    await user.type(screen.getByLabelText('Course'), 'Chemistry')
    await user.type(screen.getByLabelText('Teacher last name'), 'Green')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Grade 11')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Chemistry')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Green')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByLabelText('Active student filters')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Grade')).toHaveValue('')
    expect(screen.getByLabelText('Course')).toHaveValue('')
    expect(screen.getByLabelText('Teacher last name')).toHaveValue('')
  })

  it('shows shared classes for each classmate and links only visible schedules', async () => {
    mocks.getClassmates.mockResolvedValue([
      { student_id: 'classmate-open', full_name: 'Open Classmate', grade: 10, privacy_setting: 'school', shared_course_names: ['Biology', 'Chemistry'], can_view_schedule: true },
      { student_id: 'classmate-private', full_name: 'Private Classmate', grade: 12, privacy_setting: 'private', shared_course_names: ['Chemistry'], can_view_schedule: false },
    ])
    renderPage()

    const openRow = (await screen.findByText('Open Classmate')).closest('li') as HTMLElement
    expect(within(openRow).getByRole('list', { name: 'Classes you share with Open Classmate' })).toHaveTextContent('BiologyChemistry')
    expect(within(openRow).getByRole('link', { name: 'View schedule' })).toHaveAttribute('href', '/students/classmate-open')
    const privateRow = screen.getByText('Private Classmate').closest('li') as HTMLElement
    expect(within(privateRow).queryByRole('link')).not.toBeInTheDocument()
    expect(within(privateRow).getByText('Shared classes only')).toBeInTheDocument()
    expect(screen.getByText('2 students share at least one class with you.')).toBeInTheDocument()
  })

  it('points students with no classmates back to their schedule', async () => {
    mocks.getClassmates.mockResolvedValue([])
    renderPage()
    expect(await screen.findByRole('heading', { name: 'No shared classmates found yet.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Finish my schedule' })).toHaveAttribute('href', '/schedule')
  })

  it('shows a failed access change inside the affected student row', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
      { student_id: 'other-student', full_name: 'Riley', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
    ])
    mocks.requestScheduleAccess.mockRejectedValueOnce(new Error('That student is no longer available.'))
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'All students' }))

    const row = (await screen.findByText('Jordan')).closest('li') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Request access' }))
    expect(await within(row).findByRole('alert')).toHaveTextContent('That student is no longer available.')
    const otherRow = screen.getByText('Riley').closest('li') as HTMLElement
    expect(within(otherRow).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Request access' })).toBeEnabled()
  })

  it('offers to clear filters when nobody matches', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([])
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'All students' }))
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.selectOptions(screen.getByLabelText('Grade'), '9')

    expect(await screen.findByText('No students match those filters.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.searchStudentDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ grade: 9 })))
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' })
    await user.click(clearButtons[clearButtons.length - 1])
    expect(screen.getByLabelText('Grade')).toHaveValue('')
  })
})
