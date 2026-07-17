import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AllowGuest } from './RouteGuards'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getGuestExplorationEnabled: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../lib/supabase/guestAccess', () => ({ getGuestExplorationEnabled: mocks.getGuestExplorationEnabled }))
vi.mock('../ui/LoadingScreen', () => ({ LoadingScreen: () => <div>loading</div> }))
vi.mock('./SuspensionNotice', () => ({ SuspensionNotice: () => <div>suspended</div> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AllowGuest />}>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/students" element={<div>students page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    loading: false,
    user: null,
    isDemo: false,
    accountState: null,
    profile: null,
  })
  mocks.getGuestExplorationEnabled.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AllowGuest', () => {
  it('allows public discovery routes when guest exploration is enabled', async () => {
    renderAt('/students')
    await waitFor(() => expect(screen.getByText('students page')).toBeInTheDocument())
  })

  it('redirects a guest to home when exploration is disabled', async () => {
    mocks.getGuestExplorationEnabled.mockResolvedValue(false)
    renderAt('/students')
    await waitFor(() => expect(screen.getByText('home page')).toBeInTheDocument())
    expect(screen.queryByText('students page')).not.toBeInTheDocument()
  })
})
