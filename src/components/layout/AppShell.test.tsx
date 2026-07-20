import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
  openAccountPrompt: vi.fn(),
  openSignInPrompt: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../auth/GuestAccountPrompt', () => ({ useGuestAccountPrompt: () => ({ openAccountPrompt: mocks.openAccountPrompt, openSignInPrompt: mocks.openSignInPrompt }) }))
vi.mock('../ui/BrandLogo', () => ({ BrandLogo: () => <span>NA ScheduleShare</span> }))
vi.mock('../ui/ProfileAvatar', () => ({ ProfileAvatar: () => <span>Avatar</span> }))
vi.mock('./ScheduleAccessNotifications', () => ({ ScheduleAccessNotifications: () => <button type="button">Notifications</button> }))

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
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(within(primaryNavigation).getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(within(primaryNavigation).queryByRole('link', { name: 'Report an issue' })).not.toBeInTheDocument()
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('shows guest-safe destinations and prompts for an account on protected destinations', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, signOut: mocks.signOut })
    renderShell('/classes')
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' })

    expect(within(navigation).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(within(navigation).getByRole('link', { name: 'Classes' })).toHaveClass('active')
    await user.click(within(navigation).getByRole('button', { name: 'Classmates' }))
    await user.click(within(navigation).getByRole('button', { name: 'Students' }))
    expect(mocks.openAccountPrompt).toHaveBeenNthCalledWith(1, '/classmates')
    expect(mocks.openAccountPrompt).toHaveBeenNthCalledWith(2, '/students')
  })
})
