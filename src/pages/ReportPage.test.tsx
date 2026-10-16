import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import type { ClassSearchResult, ReportableUser } from '../lib/domain'
import { ReportPage } from './ReportPage'

const mocks = vi.hoisted(() => ({
  searchReportableUsers: vi.fn(),
  searchClasses: vi.fn(async (): Promise<unknown[]> => []),
  submitReport: vi.fn(async () => undefined),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false }) }))
vi.mock('../lib/supabase/data', () => ({
  searchClasses: mocks.searchClasses,
  searchReportableUsers: mocks.searchReportableUsers,
  submitReport: mocks.submitReport,
}))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderPage(state?: unknown, search = '') {
  return render(<ToastProvider><MemoryRouter initialEntries={[{ pathname: '/report', search, state }]}><ReportPage /></MemoryRouter></ToastProvider>)
}

const chemistry: ClassSearchResult = {
  id: 'class-chem',
  course_name_id: 'course-chem',
  course_name: 'Academic Chemistry',
  teacher_last_name: 'Patel',
  default_academic_term: 'full_year',
  is_double_period: false,
  meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
  score: 100,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReportPage target search', () => {
  it('ignores stale student results after the query changes', async () => {
    const user = userEvent.setup()
    const first = deferred<ReportableUser[]>()
    const second = deferred<ReportableUser[]>()
    mocks.searchReportableUsers.mockImplementation((query: string) => query === 'al' ? first.promise : second.promise)
    renderPage()

    await user.click(screen.getByRole('radio', { name: /A student/ }))
    const search = screen.getByPlaceholderText('Search by student name')
    await user.type(search, 'al')
    await waitFor(() => expect(mocks.searchReportableUsers).toHaveBeenCalledWith('al'))

    await user.clear(search)
    await user.type(search, 'bo')
    await waitFor(() => expect(mocks.searchReportableUsers).toHaveBeenCalledWith('bo'))

    await act(async () => { second.resolve([{ student_id: 'bob', full_name: 'Bob Current', grade: 11 }]); await second.promise })
    expect(await screen.findByText('Bob Current')).toBeInTheDocument()

    await act(async () => { first.resolve([{ student_id: 'alice', full_name: 'Alice Stale', grade: 11 }]); await first.promise })
    expect(screen.queryByText('Alice Stale')).not.toBeInTheDocument()
    expect(screen.getByText('Bob Current')).toBeInTheDocument()
  })

  it('hides old targets while a new search is pending and after it fails', async () => {
    const user = userEvent.setup()
    mocks.searchReportableUsers
      .mockResolvedValueOnce([{ student_id: 'alice', full_name: 'Alice Previous', grade: 11 }])
      .mockRejectedValueOnce(new Error('Search unavailable'))
    renderPage()

    await user.click(screen.getByRole('radio', { name: /A student/ }))
    const search = screen.getByPlaceholderText('Search by student name')
    await user.type(search, 'al')
    expect(await screen.findByText('Alice Previous')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'bo')
    expect(screen.queryByText('Alice Previous')).not.toBeInTheDocument()
    expect(await screen.findByText('Search unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Alice Previous')).not.toBeInTheDocument()
  })

  it('requires a class before sending a class report, then sends it with the class id', async () => {
    const user = userEvent.setup()
    mocks.searchClasses.mockResolvedValue([chemistry])
    renderPage()

    expect(screen.getByRole('radio', { name: /Something else/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /A class/ }))
    expect(screen.getByLabelText('What’s the problem?')).toHaveValue('incorrect_class_information')
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled()

    await user.type(screen.getByPlaceholderText('Search course or teacher last name'), 'chem')
    await user.click(await screen.findByRole('button', { name: /Academic Chemistry/ }))
    expect(screen.getByRole('button', { name: 'Change class' })).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Details/), 'Teacher should be Patel-Ruiz.')
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(mocks.submitReport).toHaveBeenCalledWith({
      reason: 'incorrect_class_information',
      explanation: 'Teacher should be Patel-Ruiz.',
      reportedUserId: undefined,
      reportedClassId: 'class-chem',
    }))
    expect(await screen.findByText('Report sent. An administrator will review it.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Details/)).toHaveValue('')
  })

  it('keeps keyboard focus in the picker when a target is chosen or changed', async () => {
    const user = userEvent.setup()
    mocks.searchClasses.mockResolvedValue([chemistry])
    renderPage()

    await user.click(screen.getByRole('radio', { name: /A class/ }))
    await user.type(screen.getByPlaceholderText('Search course or teacher last name'), 'chem')
    const option = await screen.findByRole('button', { name: /Academic Chemistry/ })
    option.focus()
    await user.keyboard('{Enter}')

    const change = screen.getByRole('button', { name: 'Change class' })
    expect(change).toHaveFocus()

    await user.keyboard('{Enter}')
    const search = screen.getByPlaceholderText('Search course or teacher last name')
    expect(search).toHaveFocus()
    expect(search).toHaveValue('')
  })

  it('verifies a student passed from another page and explains when they are gone', async () => {
    mocks.searchReportableUsers.mockResolvedValue([])
    renderPage({ reportedUser: { student_id: 'gone', full_name: 'Gone Student', grade: 12 } })

    expect(screen.getByRole('radio', { name: /A student/ })).toBeChecked()
    expect(await screen.findByRole('alert')).toHaveTextContent('That student is no longer available to report.')
    expect(mocks.searchReportableUsers).toHaveBeenCalledWith('', 'gone')
    expect(screen.getByPlaceholderText('Search by student name')).toBeInTheDocument()
    // Losing a preselected student is not a user action, so focus stays put.
    expect(screen.getByPlaceholderText('Search by student name')).not.toHaveFocus()
  })

  it('explains rate limits next to the send button', async () => {
    const user = userEvent.setup()
    mocks.submitReport.mockRejectedValueOnce(new Error('rate_limit_exceeded'))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You have submitted several reports recently.')
    expect(mocks.submitReport).toHaveBeenCalledWith(expect.objectContaining({ reason: 'other', reportedUserId: undefined, reportedClassId: undefined }))
  })

  it('fills in the error reference from a crash screen', () => {
    renderPage(undefined, '?error=8f3a2c1d')
    expect(screen.getByRole('textbox', { name: /Details/ })).toHaveValue('Error reference: 8F3A2C1D\n\nWhat I was doing: ')
  })

  it('ignores an invalid error reference', () => {
    renderPage(undefined, '?error=<script>')
    expect(screen.getByRole('textbox', { name: /Details/ })).toHaveValue('')
  })
})
