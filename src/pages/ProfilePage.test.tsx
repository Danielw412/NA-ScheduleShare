import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import { ProfilePage } from './ProfilePage'

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(async () => undefined),
  uploadProfilePicture: vi.fn(async () => undefined),
  removeProfilePicture: vi.fn(async () => undefined),
  deleteOwnAccount: vi.fn(async () => undefined),
  refreshAvatar: vi.fn(),
  refreshProfile: vi.fn(async () => undefined),
  recordAuthenticatedEvent: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  isAdmin: false,
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
    isAdmin: mocks.isAdmin,
    signOut: mocks.signOut,
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
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/auth" element={<p>Signed out</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAdmin = false
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
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
    const confirmation = await screen.findByText(/Profile saved/)
    expect(confirmation).toHaveTextContent('active immediately')
    expect(confirmation.closest('[role="status"]')).not.toBeNull()
  })

  it('explains each privacy level and blocks saving an invalid name', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('radio', { name: /Classmates/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Private/ })).toHaveAccessibleName(/Only students you approve can see your full schedule/)

    const name = screen.getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'J')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Full name must be between 2 and 100 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled()
    expect(mocks.updateProfile).not.toHaveBeenCalled()
  })

  it('keeps a failed save next to the save button', async () => {
    const user = userEvent.setup()
    mocks.updateProfile.mockRejectedValueOnce(new Error('Privacy could not be updated.'))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Privacy could not be updated.')
  })

  it('uploads and removes the authenticated user profile picture', async () => {
    const user = userEvent.setup()
    renderPage()
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Upload profile picture'), file)
    await waitFor(() => expect(mocks.uploadProfilePicture).toHaveBeenCalledWith('user-1', file))
    expect(await screen.findByText('Profile picture updated.')).toBeInTheDocument()
    expect(mocks.recordAuthenticatedEvent).toHaveBeenCalledWith('profile_picture_changed', 'succeeded')
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => expect(mocks.removeProfilePicture).toHaveBeenCalledWith('user-1'))
    expect(await screen.findByText(/Profile picture removed/)).toBeInTheDocument()
  })

  it('shows a rejected picture inline and records the rejection', async () => {
    const user = userEvent.setup()
    mocks.uploadProfilePicture.mockRejectedValueOnce(new Error('Profile pictures must be 7 MB or smaller.'))
    renderPage()
    expect(screen.getByLabelText('Upload profile picture')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    await user.upload(screen.getByLabelText('Upload profile picture'), new File([new Uint8Array([1])], 'big.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile pictures must be 7 MB or smaller.')
    expect(mocks.recordAuthenticatedEvent).toHaveBeenCalledWith('profile_picture_rejected', 'failed', { error_category: 'Profile pictures must be 7 MB or smaller.' })
  })

  it('switches between system, light, and dark appearance and remembers the choice', async () => {
    const user = userEvent.setup()
    renderPage()
    const theme = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(theme).getByRole('radio', { name: 'System' })).toBeChecked()

    await user.click(within(theme).getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('scheduleshare.theme')).toBe('dark')

    await user.click(within(theme).getByRole('radio', { name: 'Light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')

    await user.click(within(theme).getByRole('radio', { name: 'System' }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem('scheduleshare.theme')).toBeNull()
  })

  it('links administrators to the dashboard and signs out', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.queryByRole('link', { name: 'Open admin dashboard' })).not.toBeInTheDocument()
    cleanup()

    mocks.isAdmin = true
    renderPage()
    expect(screen.getByRole('link', { name: 'Open admin dashboard' })).toHaveAttribute('href', '/admin')
    expect(screen.getByText('student@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledOnce()
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
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
  })

  it('does not delete for anything other than DELETE and keeps failures in the dialog', async () => {
    const user = userEvent.setup()
    mocks.deleteOwnAccount.mockRejectedValueOnce(new Error('Your account could not be fully deleted.'))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Permanently delete your account?' })
    expect(dialog).toHaveAccessibleDescription('This can’t be undone.')
    const confirmation = within(dialog).getByLabelText('Type DELETE to confirm')

    await user.type(confirmation, 'delete{Enter}')
    expect(mocks.deleteOwnAccount).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Delete account permanently' })).toBeDisabled()

    await user.clear(confirmation)
    await user.type(confirmation, 'DELETE{Enter}')
    await waitFor(() => expect(mocks.deleteOwnAccount).toHaveBeenCalledWith('DELETE'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your account could not be fully deleted.')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
