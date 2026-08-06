import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClubJoinDialog } from './ClubJoinDialog'
import { ClubVisitNudge } from './ClubVisitNudge'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchSchedule: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../lib/supabase/data', () => ({ fetchSchedule: mocks.fetchSchedule }))

const nudgeMessage = /This site was built by the NA Computer and AI Club\./
let goTo: (path: string) => void = () => undefined

function NavigationProbe() {
  const navigate = useNavigate()
  goTo = (path) => { void navigate(path) }
  return null
}

function renderNudge() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NavigationProbe />
      <ClubVisitNudge />
    </MemoryRouter>,
  )
}

async function browseTwoMorePages() {
  await act(async () => { goTo('/classes') })
  await act(async () => { goTo('/students') })
}

beforeEach(() => {
  localStorage.clear()
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
  mocks.fetchSchedule.mockResolvedValue([{ id: 'enrollment-1' }])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ClubJoinDialog', () => {
  it('offers both club forms and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClubJoinDialog open onClose={onClose} />)

    expect(screen.getByRole('heading', { name: 'Join the NA Computer and AI Club' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign-up form/ })).toHaveAttribute('href', 'https://forms.gle/mHSP39B3FnKvCfsv6')
    expect(screen.getByRole('link', { name: /Interest form/ })).toHaveAttribute('href', 'https://forms.gle/p7xYrVRbx2AhWy2U7')

    await user.click(screen.getByRole('button', { name: 'Close club dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while closed', () => {
    const { container } = render(<ClubJoinDialog open={false} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ClubVisitNudge', () => {
  it('waits for browsing, three minutes, and an uploaded schedule before inviting the student once', async () => {
    vi.useFakeTimers()
    renderNudge()

    await act(async () => { vi.advanceTimersByTime(200_000) })
    expect(screen.queryByText(nudgeMessage)).not.toBeInTheDocument()
    expect(mocks.fetchSchedule).not.toHaveBeenCalled()

    await browseTwoMorePages()
    await act(async () => { vi.advanceTimersByTime(10_000) })

    expect(screen.getByText(nudgeMessage)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign-up form' })).toHaveAttribute('href', 'https://forms.gle/mHSP39B3FnKvCfsv6')
    expect(screen.getByRole('link', { name: 'Interest form' })).toHaveAttribute('href', 'https://forms.gle/p7xYrVRbx2AhWy2U7')
    expect(localStorage.getItem('scheduleshare:club-nudge:v1:student-1')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss club invitation' }))
    expect(screen.queryByText(nudgeMessage)).not.toBeInTheDocument()

    cleanup()
    renderNudge()
    await browseTwoMorePages()
    await act(async () => { vi.advanceTimersByTime(200_000) })
    expect(screen.queryByText(nudgeMessage)).not.toBeInTheDocument()
  })

  it('stays hidden for students without an uploaded schedule and for guests', async () => {
    vi.useFakeTimers()
    mocks.fetchSchedule.mockResolvedValue([])
    renderNudge()
    await browseTwoMorePages()
    await act(async () => { vi.advanceTimersByTime(200_000) })

    expect(screen.queryByText(nudgeMessage)).not.toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:club-nudge:v1:student-1')).toBeNull()

    cleanup()
    mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
    mocks.fetchSchedule.mockClear()
    renderNudge()
    await browseTwoMorePages()
    await act(async () => { vi.advanceTimersByTime(200_000) })

    expect(screen.queryByText(nudgeMessage)).not.toBeInTheDocument()
    expect(mocks.fetchSchedule).not.toHaveBeenCalled()
  })
})
