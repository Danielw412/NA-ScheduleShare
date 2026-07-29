import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventLogRecord } from '../lib/domain'
import { EventLogsPanel, eventLogPageNumbers } from './AdminPage'

const mocks = vi.hoisted(() => ({
  listLogsPage: vi.fn(),
  getActivitySummary: vi.fn(),
}))

vi.mock('../lib/supabase/data', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as Record<string, unknown>),
    superAdminListLogsPage: mocks.listLogsPage,
    superAdminGetActivitySummary: mocks.getActivitySummary,
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
})
