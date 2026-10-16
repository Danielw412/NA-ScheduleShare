import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../ui/Toast'
import { resetHomepageLayoutCache } from '../../features/home/useHomepageLayout'
import { HomepageLayoutPanel } from './HomepageLayoutPanel'

const mocks = vi.hoisted(() => ({
  adminGetHomepageLayout: vi.fn(),
  adminUpdateHomepageLayout: vi.fn(),
  getHomepageLayout: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../lib/supabase/data', () => ({
  adminGetHomepageLayout: mocks.adminGetHomepageLayout,
  adminUpdateHomepageLayout: mocks.adminUpdateHomepageLayout,
  getHomepageLayout: mocks.getHomepageLayout,
}))

function renderPanel(isDemo = false) {
  return render(<ToastProvider><HomepageLayoutPanel isDemo={isDemo} /></ToastProvider>)
}

beforeEach(() => {
  localStorage.clear()
  resetHomepageLayoutCache()
  mocks.useAuth.mockReturnValue({ isDemo: false })
  mocks.adminGetHomepageLayout.mockResolvedValue({ layout: 'balanced', updated_at: '2026-10-01T00:00:00Z' })
  mocks.adminUpdateHomepageLayout.mockResolvedValue(undefined)
  mocks.getHomepageLayout.mockResolvedValue('balanced')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HomepageLayoutPanel', () => {
  it('loads the saved layout and saves a new one for every visitor', async () => {
    const user = userEvent.setup()
    renderPanel()
    const balanced = await screen.findByRole('radio', { name: /Balanced/ })
    await waitFor(() => expect(balanced).toBeChecked())
    const save = screen.getByRole('button', { name: 'Save homepage layout' })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /Bell schedule first/ }))
    expect(screen.getByText('Not saved yet.')).toBeInTheDocument()
    await user.click(save)

    expect(mocks.adminUpdateHomepageLayout).toHaveBeenCalledWith('bell_schedule')
    expect(await screen.findByText('Homepage now leads with the bell schedule.')).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare.homepage-layout')).toBe('bell_schedule')
    expect(save).toBeDisabled()
  })

  it('shows the server error and keeps the unsaved choice', async () => {
    const user = userEvent.setup()
    mocks.adminUpdateHomepageLayout.mockRejectedValue(new Error('administrator_access_required'))
    renderPanel()
    await waitFor(() => expect(screen.getByRole('radio', { name: /Balanced/ })).toBeChecked())
    await user.click(screen.getByRole('radio', { name: /Bell schedule first/ }))
    await user.click(screen.getByRole('button', { name: 'Save homepage layout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('administrator_access_required')
    expect(screen.getByRole('radio', { name: /Bell schedule first/ })).toBeChecked()
    expect(localStorage.getItem('scheduleshare.homepage-layout')).not.toBe('bell_schedule')
  })

  it('previews changes locally in demo mode without calling the server', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ isDemo: true })
    renderPanel(true)
    await user.click(await screen.findByRole('radio', { name: /Bell schedule first/ }))
    await user.click(screen.getByRole('button', { name: 'Save homepage layout' }))
    expect(mocks.adminGetHomepageLayout).not.toHaveBeenCalled()
    expect(mocks.adminUpdateHomepageLayout).not.toHaveBeenCalled()
    expect(localStorage.getItem('scheduleshare.homepage-layout')).toBe('bell_schedule')
  })
})
