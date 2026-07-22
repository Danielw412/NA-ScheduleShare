import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentsPage } from './StudentsPage'

const mocks = vi.hoisted(() => ({
  searchStudentDirectory: vi.fn(),
  allowScheduleAccess: vi.fn(async () => undefined),
  removeScheduleAccess: vi.fn(async () => undefined),
  requestScheduleAccess: vi.fn(async () => undefined),
  cancelScheduleAccessRequest: vi.fn(async () => undefined),
  getClassmates: vi.fn(),
}))

vi.mock('../components/auth/DiscoveryGate', () => ({ DiscoveryGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false }) }))
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

describe('StudentsPage schedule access', () => {
  it('defaults to classmates and keeps directory search in All students', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'Classmates' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Taylor')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Student name')).not.toBeInTheDocument()

    mocks.searchStudentDirectory.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'All students' }))
    expect(screen.getByPlaceholderText('Student name')).toBeInTheDocument()
  })

  it('shows both directions of access and only relevant actions', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
      { student_id: 'public-student', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true, they_can_view_yours: 'shared_class', you_can_view_theirs: 'everyone_allowed', outgoing_request_pending: false },
    ])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'All students' }))

    expect(await screen.findByText('Jordan')).toBeInTheDocument()
    const privateCard = screen.getByText('Jordan').closest('article')
    expect(privateCard).not.toBeNull()
    expect(within(privateCard!).getByText('No access')).toBeInTheDocument()
    expect(within(privateCard!).getByText('Private')).toBeInTheDocument()
    expect(within(privateCard!).getByRole('button', { name: 'Allow access' })).toBeInTheDocument()
    expect(within(privateCard!).getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan').closest('a')).toHaveAttribute('href', '/students/public-student')
    const publicCard = screen.getByText('Alex Morgan').closest('article')
    expect(within(publicCard!).getByText('Shared class')).toBeInTheDocument()
    expect(within(publicCard!).getByText('Everyone allowed')).toBeInTheDocument()
    expect(within(publicCard!).queryByRole('button', { name: /access/i })).not.toBeInTheDocument()
  })

  it('allows, requests, and cancels access with success and disabled states', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
    ])
    render(<MemoryRouter><StudentsPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'All students' }))

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
    render(<MemoryRouter><StudentsPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'All students' }))

    expect(screen.getByPlaceholderText('Student name')).toBeInTheDocument()
    const filterToggle = screen.getByRole('button', { name: 'Filters' })
    await user.click(filterToggle)
    expect(filterToggle).toHaveAttribute('aria-expanded', 'true')

    await user.selectOptions(screen.getByLabelText('Grade'), '11')
    await user.type(screen.getByLabelText('Course'), 'Chemistry')
    await user.type(screen.getByLabelText('Teacher Last Name'), 'Green')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Grade 11')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Chemistry')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Green')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByLabelText('Active student filters')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Grade')).toHaveValue('')
    expect(screen.getByLabelText('Course')).toHaveValue('')
    expect(screen.getByLabelText('Teacher Last Name')).toHaveValue('')
  })
})
