import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppIssueDetail } from '../../lib/domain'
import { ToastProvider } from '../ui/Toast'
import { IssuesPanel, relativeTime } from './IssuesPanel'

const mocks = vi.hoisted(() => ({
  adminListAppIssues: vi.fn(),
  adminGetAppIssue: vi.fn(),
  adminFindAppIssueByReference: vi.fn(),
  adminUpdateAppIssueStatus: vi.fn(),
  adminDeleteAppIssue: vi.fn(),
  adminGetAppIssueSettings: vi.fn(),
  adminSetAppIssueIngest: vi.fn(),
}))

vi.mock('../../lib/supabase/data', () => mocks)

const issue: AppIssueDetail = {
  id: 'issue-1', fingerprint: 'web-3f9a1c07d2e4b8', source: 'web', level: 'error',
  title: "TypeError: Cannot read properties of undefined (reading 'map')", culprit: 'renderRows (assets/ClassesPage.js)', status: 'open',
  event_count: 14, user_count: 6, first_seen_at: '2026-10-13T12:00:00Z', last_seen_at: '2026-10-16T12:00:00Z',
  first_release: '4aa051f', last_release: 'b6f142c', environment: 'production', regressed_at: '2026-10-16T11:00:00Z',
  events: [{
    event_id: '8f3a2c1d9b7e4f60a1b2c3d4e5f60718', level: 'error', message: "TypeError: Cannot read properties of undefined (reading 'map')", exception_type: 'TypeError', user_id: null,
    stacktrace: [{ function: 'renderRows', filename: 'assets/ClassesPage.js', lineno: 1, colno: 4812, in_app: true }],
    breadcrumbs: [{ timestamp: 1, category: 'http', message: 'POST /rest/v1/rpc/search_classes', level: 'warning', data: { status: 500 } }],
    tags: { boundary: 'route' },
    context: { route: '/classes/:id', release: 'b6f142c' },
    created_at: '2026-10-16T12:00:00Z',
  }],
}

function renderPanel() {
  return render(<ToastProvider><IssuesPanel isDemo={false} /></ToastProvider>)
}

beforeEach(() => {
  mocks.adminListAppIssues.mockResolvedValue({ issues: [issue], total: 1 })
  mocks.adminGetAppIssue.mockResolvedValue(issue)
  mocks.adminFindAppIssueByReference.mockResolvedValue('issue-1')
  mocks.adminUpdateAppIssueStatus.mockResolvedValue(undefined)
  mocks.adminDeleteAppIssue.mockResolvedValue(undefined)
  mocks.adminGetAppIssueSettings.mockResolvedValue({ ingest_enabled: true, updated_at: '' })
  mocks.adminSetAppIssueIngest.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IssuesPanel', () => {
  it('lists grouped issues with their impact and regression state', async () => {
    renderPanel()
    const row = await screen.findByRole('button', { name: /Cannot read properties of undefined/ })
    expect(row).toHaveTextContent('14 events')
    expect(row).toHaveTextContent('6 accounts')
    expect(row).toHaveTextContent('Regressed')
    expect(mocks.adminListAppIssues).toHaveBeenCalledWith({ status: 'open', search: '', limit: 25, offset: 0 })
  })

  it('filters by status and searches', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: /Cannot read properties/ })
    await user.click(screen.getByRole('radio', { name: 'Resolved' }))
    await waitFor(() => expect(mocks.adminListAppIssues).toHaveBeenLastCalledWith({ status: 'resolved', search: '', limit: 25, offset: 0 }))
    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), 'ClassesPage{Enter}')
    await waitFor(() => expect(mocks.adminListAppIssues).toHaveBeenLastCalledWith({ status: 'resolved', search: 'ClassesPage', limit: 25, offset: 0 }))
  })

  it('shows the stack, breadcrumbs, and context, then resolves the issue', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Cannot read properties/ }))
    const dialog = await screen.findByRole('dialog', { name: /Cannot read properties/ })
    expect(await within(dialog).findByText('renderRows')).toBeInTheDocument()
    expect(within(dialog).getByText('POST /rest/v1/rpc/search_classes')).toBeInTheDocument()
    expect(within(dialog).getByText('8F3A2C1D')).toBeInTheDocument()
    expect(within(dialog).getByText('Open, regressed')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    expect(mocks.adminUpdateAppIssueStatus).toHaveBeenCalledWith('issue-1', 'resolved')
    expect(await screen.findByText('Issue resolved. It reopens if it happens again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Issues' })).toHaveFocus())
  })

  it('asks before deleting an issue', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Cannot read properties/ }))
    const dialog = await screen.findByRole('dialog', { name: /Cannot read properties/ })
    await within(dialog).findByText('renderRows')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mocks.adminDeleteAppIssue).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete issue' }))
    expect(mocks.adminDeleteAppIssue).toHaveBeenCalledWith('issue-1')
  })

  it('finds the issue behind a student’s error reference', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: /Cannot read properties/ })
    await user.type(screen.getByRole('textbox', { name: 'Error reference' }), 'zz')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 8-character error reference')
    await user.clear(screen.getByRole('textbox', { name: 'Error reference' }))
    await user.type(screen.getByRole('textbox', { name: 'Error reference' }), '8F3A2C1D')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    expect(mocks.adminFindAppIssueByReference).toHaveBeenCalledWith('8f3a2c1d')
    expect(await screen.findByRole('dialog', { name: /Cannot read properties/ })).toBeInTheDocument()
  })

  it('pauses and resumes new reports', async () => {
    const user = userEvent.setup()
    renderPanel()
    const toggle = await screen.findByRole('checkbox', { name: 'Accept new reports' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(mocks.adminSetAppIssueIngest).toHaveBeenCalledWith(false)
    expect(await screen.findByText('New error reports are paused.')).toBeInTheDocument()
  })

  it('formats how long ago an issue was seen', () => {
    const now = new Date('2026-10-16T12:00:00Z').getTime()
    expect(relativeTime('2026-10-16T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-10-16T11:45:00Z', now)).toBe('15 minutes ago')
    expect(relativeTime('2026-10-15T12:00:00Z', now)).toBe('yesterday')
  })

  it('shows stored details such as the component stack', async () => {
    const user = userEvent.setup()
    mocks.adminGetAppIssue.mockResolvedValue({ ...issue, events: [{ ...issue.events[0], context: { ...issue.events[0].context, extra: { component_stack: 'at ClassesPage\nat Outlet' } } }] })
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Cannot read properties/ }))
    const dialog = await screen.findByRole('dialog', { name: /Cannot read properties/ })
    expect(await within(dialog).findByText(/at ClassesPage/)).toBeInTheDocument()
    expect(within(dialog).getByText('warning')).toBeInTheDocument()
  })

  it('ignores a slow page of results from a previous filter', async () => {
    const user = userEvent.setup()
    let resolveSlow: (value: unknown) => void = () => undefined
    mocks.adminListAppIssues
      .mockResolvedValueOnce({ issues: [issue], total: 30 })
      .mockReturnValueOnce(new Promise((resolve) => { resolveSlow = resolve }))
      .mockResolvedValueOnce({ issues: [], total: 0 })
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Show more issues' }))
    await user.click(screen.getByRole('radio', { name: 'Ignored' }))
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
    resolveSlow({ issues: [{ ...issue, id: 'stale' }], total: 30 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cannot read properties/ })).not.toBeInTheDocument()
  })
})
