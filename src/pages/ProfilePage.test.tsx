import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfilePage } from './ProfilePage'

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(async () => undefined),
  uploadProfilePicture: vi.fn(async () => undefined),
  removeProfilePicture: vi.fn(async () => undefined),
  deleteOwnAccount: vi.fn(async () => undefined),
  refreshAvatar: vi.fn(),
  refreshProfile: vi.fn(async () => undefined),
  recordAuthenticatedEvent: vi.fn(async () => undefined),
}))

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'student@example.com' },
    profile: {
      id: 'user-1',
      full_name: 'Jordan Student',
      grade: 11,
      privacy_setting: 'classmates',
      onboarding_completed: true,
      created_at: '2026-07-17T00:00:00Z',
      updated_at: '2026-07-17T00:00:00Z',
    },
    isDemo: false,
    updateProfile: mocks.updateProfile,
    refreshAvatar: mocks.refreshAvatar,
    refreshProfile: mocks.refreshProfile,
  }),
}))

vi.mock('../lib/profile', () => ({
  profilePictureUrl: () => null,
  uploadProfilePicture: mocks.uploadProfilePicture,
  removeProfilePicture: mocks.removeProfilePicture,
  deleteOwnAccount: mocks.deleteOwnAccount,
}))

vi.mock('../lib/supabase/data', () => ({
  recordAuthenticatedEvent: mocks.recordAuthenticatedEvent,
}))

function renderPage() {
  return render(<MemoryRouter><ProfilePage /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('ProfilePage', () => {
  it('updates the full name and existing privacy setting with success feedback', async () => {
    const user = userEvent.setup()
    renderPage()
    const name = screen.getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Jordan Updated')
    await user.click(screen.getByRole('radio', { name: /Anyone/ }))
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ fullName: 'Jordan Updated', privacySetting: 'school' }))
    expect(await screen.findByRole('status')).toHaveTextContent('active immediately')
  })

  it('uploads and removes the authenticated user profile picture', async () => {
    const user = userEvent.setup()
    renderPage()
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Upload profile picture'), file)
    await waitFor(() => expect(mocks.uploadProfilePicture).toHaveBeenCalledWith('user-1', file))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => expect(mocks.removeProfilePicture).toHaveBeenCalledWith('user-1'))
  })

  it('requires typing DELETE before permanent account deletion', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    const finalDelete = screen.getByRole('button', { name: 'Delete account permanently' })
    expect(finalDelete).toBeDisabled()
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(finalDelete).toBeEnabled()
    await user.click(finalDelete)
    await waitFor(() => expect(mocks.deleteOwnAccount).toHaveBeenCalledWith('DELETE'))
  })
})
