import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClubPromptPanel } from './AdminPage'

const mocks = vi.hoisted(() => ({
  adminGetSettings: vi.fn(),
  adminUpdateSettings: vi.fn(),
}))

vi.mock('../lib/supabase/data', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as Record<string, unknown>),
    adminGetClubPromptSettings: mocks.adminGetSettings,
    adminUpdateClubPromptSettings: mocks.adminUpdateSettings,
  }
})

beforeEach(() => {
  mocks.adminGetSettings.mockResolvedValue({ enabled: true, delay_seconds: 180, updated_at: '2026-08-06T00:00:00Z' })
  mocks.adminUpdateSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('admin club invitation settings', () => {
  it('saves the toggle and the delay', async () => {
    const user = userEvent.setup()
    render(<ClubPromptPanel isDemo={false} />)

    const delay = await screen.findByLabelText(/Delay before it appears/)
    expect(delay).toHaveValue(180)
    expect(screen.getByText(/3 minutes of active time/)).toBeInTheDocument()

    await user.clear(delay)
    await user.type(delay, '600')
    await user.click(screen.getByRole('button', { name: 'Save invitation settings' }))

    await waitFor(() => expect(mocks.adminUpdateSettings).toHaveBeenCalledWith({ enabled: true, delay_seconds: 600 }))
    expect(await screen.findByRole('status')).toHaveTextContent('Club invitation settings saved.')
  })

  it('rejects a delay outside the supported range and can disable the popup', async () => {
    const user = userEvent.setup()
    render(<ClubPromptPanel isDemo={false} />)

    const delay = await screen.findByLabelText(/Delay before it appears/)
    await user.clear(delay)
    await user.type(delay, '5')
    await user.click(screen.getByRole('button', { name: 'Save invitation settings' }))

    expect(delay).toBeInvalid()
    expect(mocks.adminUpdateSettings).not.toHaveBeenCalled()

    await user.clear(delay)
    await user.type(delay, '300')
    await user.click(screen.getByRole('checkbox', { name: /Show the timed invitation/ }))
    await user.click(screen.getByRole('button', { name: 'Save invitation settings' }))

    await waitFor(() => expect(mocks.adminUpdateSettings).toHaveBeenCalledWith({ enabled: false, delay_seconds: 300 }))
  })
})
