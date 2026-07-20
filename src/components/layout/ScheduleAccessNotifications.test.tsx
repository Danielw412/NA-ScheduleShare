import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleAccessNotifications } from './ScheduleAccessNotifications'

const mocks = vi.hoisted(() => ({
  getScheduleAccessNotifications: vi.fn(),
  markScheduleAccessNotificationsRead: vi.fn(async () => undefined),
  respondScheduleAccessRequest: vi.fn<(requestId: string, allow: boolean) => Promise<void>>(async () => undefined),
}))

vi.mock('../../lib/supabase/client', () => ({ supabase: null }))
vi.mock('../../lib/supabase/data', () => ({
  announceScheduleAccessChanged: vi.fn(),
  getScheduleAccessNotifications: mocks.getScheduleAccessNotifications,
  markScheduleAccessNotificationsRead: mocks.markScheduleAccessNotificationsRead,
  respondScheduleAccessRequest: mocks.respondScheduleAccessRequest,
  scheduleAccessChangedEvent: 'scheduleshare:schedule-access-changed',
}))
vi.mock('../ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))

const notifications = {
  count: 2,
  notifications: [
    { request_id: 'request-1', kind: 'incoming_request', status: 'pending', student_id: 'student-2', full_name: 'Jordan Lee', created_at: '2026-07-19T10:00:00Z', updated_at: '2026-07-19T10:00:00Z', read: false },
    { request_id: 'request-2', kind: 'request_update', status: 'approved', student_id: 'student-3', full_name: 'Alex Morgan', created_at: '2026-07-18T10:00:00Z', updated_at: '2026-07-19T09:00:00Z', read: false },
  ],
}

beforeEach(() => {
  mocks.getScheduleAccessNotifications.mockResolvedValue(notifications)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScheduleAccessNotifications', () => {
  it('shows a badge, pending requests first, and recent request updates', async () => {
    const user = userEvent.setup()
    render(<ScheduleAccessNotifications userId="student-1" />)

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 pending or unread' }))

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    expect(screen.getByText(/requested access to your schedule/i)).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    expect(screen.getByText(/allowed access to their schedule/i)).toBeInTheDocument()
    await waitFor(() => expect(mocks.markScheduleAccessNotificationsRead).toHaveBeenCalled())
  })

  it('disables response actions while approving and confirms success', async () => {
    const user = userEvent.setup()
    let resolveResponse: () => void = () => undefined
    mocks.respondScheduleAccessRequest.mockReturnValueOnce(new Promise<void>((resolve) => { resolveResponse = resolve }))
    render(<ScheduleAccessNotifications userId="student-1" />)
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 pending or unread' }))

    await user.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()

    resolveResponse()
    await waitFor(() => expect(mocks.respondScheduleAccessRequest).toHaveBeenCalledWith('request-1', true))
    expect(await screen.findByRole('status')).toHaveTextContent('Schedule access allowed')
  })
})
