import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPromptRoute } from './AuthPromptRoute'
import { GuestAccountPromptProvider } from './GuestAccountPrompt'
import { RequireAuth } from './RouteGuards'

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))

function renderRoutes(initialEntry: string, includeProtectedRoute = false) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GuestAccountPromptProvider>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/auth" element={<AuthPromptRoute />} />
          {includeProtectedRoute ? <Route element={<RequireAuth />}><Route path="/students" element={<div>Students</div>} /></Route> : null}
        </Routes>
      </GuestAccountPromptProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    user: null,
    loading: false,
    configurationMissing: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sign-in popup routing', () => {
  it('opens sign in as a popup for the legacy auth URL', async () => {
    renderRoutes('/auth')
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('opens account creation from the legacy sign-up URL and closes without leaving the page', async () => {
    const user = userEvent.setup()
    renderRoutes('/auth?mode=sign-up')
    expect(await screen.findByRole('dialog', { name: 'Create your account' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close account dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('opens sign in as a popup when a guest requests a protected route', async () => {
    renderRoutes('/students', true)
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('fails closed and offers a retry when an authenticated profile cannot load', async () => {
    const refreshProfile = vi.fn(async () => undefined)
    mocks.useAuth.mockReturnValue({
      user: { id: 'student-a' },
      profile: null,
      accountState: { suspended: false, deleted: false },
      loading: false,
      refreshProfile,
    })
    const user = userEvent.setup()

    renderRoutes('/students', true)
    expect(screen.queryByText('Students')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'We couldn’t load your account' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refreshProfile).toHaveBeenCalledOnce()
  })
})
