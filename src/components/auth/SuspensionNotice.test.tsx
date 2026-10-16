import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuspensionNotice } from './SuspensionNotice'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => undefined),
  accountState: { suspended: true, suspension_reason: null as string | null, deleted: false },
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: () => ({ accountState: mocks.accountState, signOut: mocks.signOut }) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.accountState = { suspended: true, suspension_reason: null, deleted: false }
})
afterEach(() => cleanup())

describe('SuspensionNotice', () => {
  it('explains the suspension, shows the administrator’s reason, and offers sign out', async () => {
    const user = userEvent.setup()
    mocks.accountState = { suspended: true, suspension_reason: 'Impersonating another student.', deleted: false }
    render(<SuspensionNotice />)

    expect(screen.getByRole('main', { name: 'Your account is suspended' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reason from the administrator' })).toBeInTheDocument()
    expect(screen.getByText('Impersonating another student.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('omits the reason block when none was given and names deleted accounts plainly', () => {
    const { unmount } = render(<SuspensionNotice />)
    expect(screen.queryByRole('heading', { name: 'Reason from the administrator' })).not.toBeInTheDocument()
    unmount()

    mocks.accountState = { suspended: false, suspension_reason: null, deleted: true }
    render(<SuspensionNotice />)
    expect(screen.getByRole('heading', { name: 'This account was deleted' })).toBeInTheDocument()
  })
})
