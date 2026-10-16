import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import type { EventLogRecord } from '../lib/domain'
import { EventLogsPanel, eventLogPageNumbers } from './AdminPage'

const mocks = vi.hoisted(() => ({
  listLogsPage: vi.fn(),
  getActivitySummary: vi.fn(),
  deleteLog: vi.fn(),
  deleteLogs: vi.fn(),
}))

vi.mock('../lib/supabase/data', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as Record<string, unknown>),
    superAdminListLogsPage: mocks.listLogsPage,
    superAdminGetActivitySummary: mocks.getActivitySummary,
    superAdminDeleteLog: mocks.deleteLog,
    superAdminDeleteLogs: mocks.deleteLogs,
  }
})

function eventLog(index: number): EventLogRecord {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    log_category: 'audit',
    event_type: `test_event_${index}`,
    actor_user_id: null,
    actor_name: null,
    subject_user_id: null,
    subject_name: null,
    target_type: 'test',
    target_id: String(index),
    result: 'succeeded',
    metadata: {},
    created_at: new Date(2026, 6, 29, 12, 0, index % 60).toISOString(),
  }
}

beforeEach(() => {
  mocks.listLogsPage.mockImplementation(async ({ limit, offset }: { limit: number; offset: number }) => ({
    logs: Array.from({ length: Math.min(limit, 120 - offset) }, (_, index) => eventLog(offset + index + 1)),
    total: 120,
  }))
  mocks.getActivitySummary.mockResolvedValue({
    total_users: 10,
    daily_active_users: 4,
    weekly_active_users: 8,
    schedule_imports: 12,
    schedules_shared: 9,
    access_requests: 3,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('super-admin event log pagination', () => {
  it('builds compact page-number ranges around the current page', () => {
    expect(eventLogPageNumbers(1, 3)).toEqual([1, 2, 3])
    expect(eventLogPageNumbers(6, 12)).toEqual([1, 5, 6, 7, 12])
    expect(eventLogPageNumbers(11, 12)).toEqual([1, 8, 9, 10, 11, 12])
  })

  it('loads selectable page sizes and navigates with numbered and arrow controls', async () => {
    const user = userEvent.setup()
    render(<EventLogsPanel />)

    expect(await screen.findByText('Showing 1–50 of 120 matching logs')).toBeInTheDocument()
    expect(mocks.listLogsPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }))
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => expect(mocks.listLogsPage).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 50 })))
    expect(await screen.findByText('Showing 51–100 of 120 matching logs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mocks.listLogsPage).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 100 })))
    expect(await screen.findByText('Showing 101–120 of 120 matching logs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Logs per page'), '25')
    await waitFor(() => expect(mocks.listLogsPage).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25, offset: 0 })))
    expect(await screen.findByText('Showing 1–25 of 120 matching logs')).toBeInTheDocument()
  })

  it('deletes one log only after its typed confirmation phrase', async () => {
    const user = userEvent.setup()
    mocks.deleteLog.mockResolvedValue(undefined)
    render(<ToastProvider><EventLogsPanel /></ToastProvider>)
    await user.click(await screen.findByRole('button', { name: 'Delete test_event_1 log' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this log record?' })
    const field = within(dialog).getByLabelText('Type DELETE LOG 00000000 to confirm')
    await user.type(field, 'delete log 00000000')
    expect(within(dialog).getByRole('button', { name: 'Delete log' })).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'DELETE LOG 00000000')
    await user.click(within(dialog).getByRole('button', { name: 'Delete log' }))
    await waitFor(() => expect(mocks.deleteLog).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001'))
    expect(await screen.findByText('The selected log was permanently deleted.')).toBeInTheDocument()
  })

  it('deletes every matching log with the current filters after the typed phrase', async () => {
    const user = userEvent.setup()
    mocks.deleteLogs.mockResolvedValue(120)
    render(<ToastProvider><EventLogsPanel /></ToastProvider>)
    await screen.findByText('Showing 1–50 of 120 matching logs')
    await user.selectOptions(screen.getByLabelText('Log'), 'audit')
    await user.click(screen.getByRole('button', { name: 'Delete matching logs' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete all 120 matching logs?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocks.deleteLogs).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete matching logs' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete all 120 matching logs?' })
    await user.type(within(confirm).getByLabelText('Type DELETE FILTERED LOGS PERMANENTLY to confirm'), 'DELETE FILTERED LOGS PERMANENTLY')
    await user.click(within(confirm).getByRole('button', { name: 'Delete matching logs' }))
    await waitFor(() => expect(mocks.deleteLogs).toHaveBeenCalledWith(expect.objectContaining({ category: 'audit', event: '', user: '' })))
    expect(await screen.findByText('120 logs permanently deleted.')).toBeInTheDocument()
  })
})
