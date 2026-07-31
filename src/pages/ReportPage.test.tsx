import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportableUser } from '../lib/domain'
import { ReportPage } from './ReportPage'

const mocks = vi.hoisted(() => ({
  searchReportableUsers: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false }) }))
vi.mock('../lib/supabase/data', () => ({
  searchClasses: vi.fn(async () => []),
  searchReportableUsers: mocks.searchReportableUsers,
  submitReport: vi.fn(async () => undefined),
}))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
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
    render(<MemoryRouter><ReportPage /></MemoryRouter>)

    await user.selectOptions(screen.getByLabelText('What are you reporting?'), 'user')
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
    render(<MemoryRouter><ReportPage /></MemoryRouter>)

    await user.selectOptions(screen.getByLabelText('What are you reporting?'), 'user')
    const search = screen.getByPlaceholderText('Search by student name')
    await user.type(search, 'al')
    expect(await screen.findByText('Alice Previous')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'bo')
    expect(screen.queryByText('Alice Previous')).not.toBeInTheDocument()
    expect(await screen.findByText('Search unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Alice Previous')).not.toBeInTheDocument()
  })
})
