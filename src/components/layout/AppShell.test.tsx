import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
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
vi.mock('../../features/bell/BellScheduleProvider', () => ({ BellScheduleProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('../bell/BellNowIndicator', () => ({ BellNowIndicator: ({ variant }: { variant: string }) => <span data-testid={`bell-${variant}`}>Live bell</span> }))
vi.mock('./ScheduleAccessNotifications', () => ({ ScheduleAccessNotifications: ({ variant }: { variant: string }) => <button type="button" data-variant={variant}>Notifications</button> }))

function renderShell(path = '/classes') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<div>Page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function tabBar() {
  return document.querySelector('.tabbar') as HTMLElement
}

function sidebar() {
  return document.querySelector('.sidebar') as HTMLElement
}

function setDesktop(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
}

beforeEach(() => {
  setDesktop(false)
  mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: true })
  mocks.useAuth.mockReturnValue({
    user: { id: 'student-1', email: 'alex@example.com' },
    profile: { id: 'student-1', full_name: 'Alex Morgan', grade: 11, updated_at: '2026-07-18T00:00:00Z' },
    isAdmin: false,
    signOut: mocks.signOut,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AppShell', () => {
  it('keeps View Classes detail navigation in the same page transition container', () => {
    expect(pageTransitionKey('/classes')).toBe('/classes')
    expect(pageTransitionKey('/classes/class-123')).toBe('/classes')
    expect(pageTransitionKey('/schedule')).toBe('/schedule')
  })

  it('gives signed-in students five tab destinations and highlights the current one', () => {
    renderShell('/classes')
    const tabs = within(tabBar())

    expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/')
    expect(tabs.getByRole('link', { name: 'Today' })).not.toHaveClass('active')
    expect(tabs.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(tabs.getByRole('link', { name: 'Classes' })).toHaveClass('active')
    expect(tabs.getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/students')
    expect(tabs.getByRole('link', { name: 'Engine' })).toHaveAttribute('href', '/schedule-engine')
    expect(tabs.queryByRole('link', { name: 'Bells' })).not.toBeInTheDocument()
    expect(within(sidebar()).getByRole('link', { name: 'Bell schedule' })).toHaveAttribute('href', '/bell')
  })

  it('keeps account actions in one menu that closes with Escape and restores focus', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    const trigger = screen.getByRole('button', { name: 'Account menu for Alex Morgan' })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = within(screen.getByRole('navigation', { name: 'Account' }))
    expect(menu.getByRole('link', { name: 'Profile and privacy' })).toHaveAttribute('href', '/profile')
    expect(menu.getByRole('link', { name: 'Report a problem' })).toHaveAttribute('href', '/report')
    expect(menu.getByRole('link', { name: 'Why ScheduleShare?' })).toHaveAttribute('href', '/why-scheduleshare')
    expect(menu.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
    expect(screen.getByText('alex@example.com')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('closes the account menu when keyboard focus leaves it', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    await user.click(screen.getByRole('button', { name: 'Account menu for Alex Morgan' }))
    act(() => screen.getByRole('link', { name: 'Profile and privacy' }).focus())
    expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument()
    act(() => within(tabBar()).getByRole('link', { name: 'Today' }).focus())
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('returns focus to the account button before opening the club dialog', async () => {
    const user = userEvent.setup()
    mocks.openClubDialog.mockImplementation(() => {
      expect(screen.getByRole('button', { name: 'Account menu for Alex Morgan' })).toHaveFocus()
    })
    renderShell('/classes')
    await user.click(screen.getByRole('button', { name: 'Account menu for Alex Morgan' }))
    await user.click(within(document.querySelector('.account-menu-panel') as HTMLElement).getByRole('button', { name: 'Join the Computer and AI Club' }))
    expect(mocks.openClubDialog).toHaveBeenCalledTimes(1)
  })

  it('shows administrators the administration link and opens the club dialog from the menu', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ ...mocks.useAuth(), isAdmin: true })
    renderShell('/classes')
    await user.click(screen.getByRole('button', { name: 'Account menu for Alex Morgan' }))
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin')
    await user.click(within(document.querySelector('.account-menu-panel') as HTMLElement).getByRole('button', { name: 'Join the Computer and AI Club' }))
    expect(mocks.openClubDialog).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('removes Why ScheduleShare links when the page is taken down', async () => {
    const user = userEvent.setup()
    mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: false })
    renderShell('/classes')
    expect(within(screen.getByRole('navigation', { name: 'Footer' })).queryByRole('link', { name: 'Why ScheduleShare?' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account menu for Alex Morgan' }))
    expect(screen.queryByRole('link', { name: 'Why ScheduleShare?' })).not.toBeInTheDocument()
  })

  it('shows the live bell pill on phones except where the page already shows the bell', () => {
    const { unmount } = renderShell('/classes')
    expect(screen.getByTestId('bell-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('bell-sidebar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute('data-variant', 'icon')
    unmount()

    renderShell('/')
    expect(screen.queryByTestId('bell-pill')).not.toBeInTheDocument()
    cleanup()
    renderShell('/bell')
    expect(screen.queryByTestId('bell-pill')).not.toBeInTheDocument()
  })

  it('moves the live bell, notifications, and account into the sidebar on desktop', () => {
    setDesktop(true)
    renderShell('/classes')
    const side = within(sidebar())
    expect(side.getByTestId('bell-sidebar')).toBeInTheDocument()
    expect(side.getByRole('button', { name: 'Notifications' })).toHaveAttribute('data-variant', 'row')
    expect(side.getByRole('button', { name: 'Account menu for Alex Morgan' })).toBeInTheDocument()
    expect(screen.queryByTestId('bell-pill')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Account menu/ })).toHaveLength(1)
  })

  it('shows guest-safe destinations and prompts for an account on protected ones', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, signOut: mocks.signOut })
    renderShell('/classes')
    const tabs = within(tabBar())

    expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/')
    expect(tabs.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule')
    expect(tabs.getByRole('link', { name: 'Classes' })).toHaveClass('active')
    await user.click(tabs.getByRole('button', { name: 'Students' }))
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/students')
    await user.click(tabs.getByRole('button', { name: 'Engine' }))
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/schedule-engine')
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument()

    await user.click(within(document.querySelector('.topbar') as HTMLElement).getByRole('button', { name: 'Sign in' }))
    expect(mocks.openSignInPrompt).toHaveBeenCalledWith('/schedule')
    await user.click(within(sidebar()).getByRole('button', { name: 'Create account' }))
    expect(mocks.openAccountPrompt).toHaveBeenCalledWith('/schedule')
    expect(within(screen.getByRole('navigation', { name: 'Footer' })).getByRole('link', { name: 'Why ScheduleShare?' })).toBeInTheDocument()
  })

  it('moves keyboard focus to the new page after navigating', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    await user.click(within(tabBar()).getByRole('link', { name: 'Schedule' }))
    expect(document.getElementById('main-content')).toHaveFocus()
  })

  it('offers a skip link straight to the page content', async () => {
    const user = userEvent.setup()
    renderShell('/classes')
    await user.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(document.getElementById('main-content')).toHaveFocus()
  })
})
