import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuestSchedulePrompt } from './GuestSchedulePrompt'

const mocks = vi.hoisted(() => ({ openAccountPrompt: vi.fn() }))
vi.mock('./GuestAccountPrompt', () => ({ useGuestAccountPrompt: () => ({ openAccountPrompt: mocks.openAccountPrompt, openSignInPrompt: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GuestSchedulePrompt', () => {
  it('renders nothing while closed', () => {
    render(<GuestSchedulePrompt open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains why schedules are locked and lets guests dismiss it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<GuestSchedulePrompt open onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Create an account to continue' })
    expect(dialog).toHaveAccessibleDescription(/view schedules from students who have chosen to share with you/)
    // Public share links show a schedule to anyone with the link, so the
    // reassurance must not claim signed-out visitors never see one.
    expect(dialog).toHaveTextContent('Schedules are only shown to signed-in students, or to people a student sends a share link to.')
    expect(dialog).not.toHaveTextContent(/never shown/i)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.openAccountPrompt).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close schedule prompt' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('opens account creation and returns the guest to their schedule afterwards', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<GuestSchedulePrompt open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/schedule')
  })
})
