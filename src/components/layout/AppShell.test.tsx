import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../auth/GuestAccountPrompt', () => ({ useGuestAccountPrompt: () => ({ openAccountPrompt: vi.fn(), openSignInPrompt: vi.fn() }) }))
vi.mock('../ui/BrandLogo', () => ({ BrandLogo: () => <span>NA ScheduleShare</span> }))
vi.mock('../ui/ProfileAvatar', () => ({ ProfileAvatar: () => <span>Avatar</span> }))

function renderShell(path = '/classes') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}><Route path="*" element={<div>Page content</div>} /></Route></Routes></MemoryRouter>)
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    user: { id: 'student-1' },
    profile: { id: 'student-1', full_name: 'Alex Morgan', updated_at: '2026-07-18T00:00:00Z' },
    isAdmin: false,
    signOut: mocks.signOut,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AppShell mobile navigation', () => {
  it('provides the four authenticated destinations and highlights the current route', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' })

    expect(within(navigation).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(within(navigation).getByRole('link', { name: 'Classes' })).toHaveClass('active')
    expect(within(navigation).getByRole('link', { name: 'Classmates' })).toHaveAttribute('href', '/classmates')
    expect(within(navigation).getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/students')

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNavigation).getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(within(primaryNavigation).getByRole('link', { name: 'Report an issue' })).toBeInTheDocument()
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('does not render the authenticated bottom navigation for guests', () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, signOut: mocks.signOut })
    renderShell('/')
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).not.toBeInTheDocument()
  })
})
