import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomepageStatisticPanel } from './AdminPage'

const mocks = vi.hoisted(() => ({
  adminGetSettings: vi.fn(),
  adminUpdateSettings: vi.fn(),
  getStatistic: vi.fn(),
}))

vi.mock('../lib/supabase/data', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as Record<string, unknown>),
    adminGetHomepageStatisticSettings: mocks.adminGetSettings,
    adminUpdateHomepageStatisticSettings: mocks.adminUpdateSettings,
    getHomepageStatistic: mocks.getStatistic,
  }
})

beforeEach(() => {
  mocks.adminGetSettings.mockResolvedValue({
    shown: true,
    statistic_key: 'students_joined',
    minimum_value: 25,
    activity_scope: 'total',
    updated_at: '2026-07-17T00:00:00Z',
  })
  mocks.getStatistic.mockResolvedValue({
    statistic_key: 'students_joined',
    activity_scope: 'total',
    statistic_value: 137,
    statistic_label: 'NA students joined',
  })
  mocks.adminUpdateSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('admin homepage statistic settings', () => {
  it('configures visibility, real statistic, threshold, and activity window without a number override', async () => {
    const user = userEvent.setup()
    render(<HomepageStatisticPanel isDemo={false} />)
    expect(await screen.findByText('137 NA students joined')).toBeInTheDocument()
    expect(screen.queryByLabelText(/displayed number/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Show homepage statistic/ }))
    await user.selectOptions(screen.getByLabelText('Statistic'), 'class_connections')
    const minimum = screen.getByLabelText('Minimum real value')
    await user.clear(minimum)
    await user.type(minimum, '1000')
    await user.selectOptions(screen.getByLabelText('Activity window'), 'recent')
    await user.click(screen.getByRole('button', { name: 'Save homepage settings' }))

    await waitFor(() => expect(mocks.adminUpdateSettings).toHaveBeenCalledWith({
      shown: false,
      statistic_key: 'class_connections',
      minimum_value: 1000,
      activity_scope: 'recent',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('database-calculated')
  })
})
