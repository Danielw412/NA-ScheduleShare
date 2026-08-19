import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell, pageTransitionKey } from './AppShell'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  signOut: vi.fn(async () => undefined),
  openAccountPrompt: vi.fn(),
  openSignInPrompt: vi.fn(),
  openClubDialog: vi.fn(),
  useClubPrompt: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../auth/GuestAccountPrompt', () => ({ useGuestAccountPrompt: () => ({ openAccountPrompt: mocks.openAccountPrompt, openSignInPrompt: mocks.openSignInPrompt }) }))
vi.mock('../club/ClubPromptProvider', () => ({ useClubPrompt: mocks.useClubPrompt }))
vi.mock('../ui/BrandLogo', () => ({ BrandLogo: () => <span>NA ScheduleShare</span> }))
vi.mock('../ui/ProfileAvatar', () => ({ ProfileAvatar: () => <span>Avatar</span> }))
vi.mock('./ScheduleAccessNotifications', () => ({ ScheduleAccessNotifications: () => <button type="button">Notifications</button> }))

function renderShell(path = '/classes') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}><Route path="*" element={<div>Page content</div>} /></Route></Routes></MemoryRouter>)
}

beforeEach(() => {
  mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: true })
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
  it('keeps View Classes detail navigation in the same page transition container', () => {
    expect(pageTransitionKey('/classes')).toBe('/classes')
    expect(pageTransitionKey('/classes/class-123')).toBe('/classes')
    expect(pageTransitionKey('/schedule')).toBe('/schedule')
  })

  it('provides the four authenticated destinations and highlights the current route', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' })

    expect(within(navigation).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveClass('active')
    expect(within(navigation).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(within(navigation).getByRole('link', { name: 'Classes' })).toHaveClass('active')
    expect(within(navigation).getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/students')

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my profile' })).toHaveAttribute('href', '/profile')
    expect(within(primaryNavigation).getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(within(primaryNavigation).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(within(primaryNavigation).queryByRole('link', { name: 'Report an issue' })).not.toBeInTheDocument()
    const footerNavigation = screen.getByRole('navigation', { name: 'Footer navigation' })
    expect(within(footerNavigation).getByRole('link', { name: 'Why ScheduleShare?' })).toHaveAttribute('href', '/why-scheduleshare')
    expect(within(footerNavigation).getByRole('button', { name: 'Join Computer and AI club' })).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/i)).not.toBeInTheDocument()
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('closes the expandable navigation with Escape and restores focus', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    const toggle = screen.getByRole('button', { name: 'Open navigation' })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'primary-navigation')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('removes the Why ScheduleShare footer link when the page is taken down', () => {
    mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: false })
    renderShell('/classes')

    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' })).queryByRole('link', { name: 'Why ScheduleShare?' })).not.toBeInTheDocument()
  })

  it('shows guest-safe destinations and prompts for an account on protected destinations', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, signOut: mocks.signOut })
    renderShell('/classes')
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' })

    expect(within(navigation).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(navigation).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(within(navigation).getByRole('link', { name: 'Classes' })).toHaveClass('active')
    await user.click(within(navigation).getByRole('button', { name: 'Students' }))
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/students')
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open my profile' })).not.toBeInTheDocument()
    const mobileCreateAccount = screen.getAllByRole('button', { name: 'Create account' }).find((button) => button.classList.contains('mobile-create-account-button'))
    expect(mobileCreateAccount).toBeDefined()
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' })).queryByRole('link', { name: 'Why ScheduleShare?' })).not.toBeInTheDocument()
    await user.click(mobileCreateAccount!)
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/schedule')
  })
})
