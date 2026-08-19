import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhyScheduleShareRoute } from './WhyScheduleShareRoute'

const mocks = vi.hoisted(() => ({
  getWhyScheduleShareEnabled: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../lib/supabase/data', () => ({ getWhyScheduleShareEnabled: mocks.getWhyScheduleShareEnabled }))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/why-scheduleshare']}>
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="/why-scheduleshare" element={<WhyScheduleShareRoute><h1>Why ScheduleShare</h1></WhyScheduleShareRoute>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ isDemo: false })
  mocks.getWhyScheduleShareEnabled.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WhyScheduleShareRoute', () => {
  it('renders the page only while it is enabled', async () => {
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'Why ScheduleShare' })).toBeInTheDocument()
  })

  it('redirects direct visits to home when the page is disabled', async () => {
    mocks.getWhyScheduleShareEnabled.mockResolvedValue(false)
    renderRoute()

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Why ScheduleShare' })).not.toBeInTheDocument()
  })

  it('does not reveal the page while visibility is loading', () => {
    mocks.getWhyScheduleShareEnabled.mockReturnValue(new Promise(() => undefined))
    renderRoute()

    expect(screen.getByRole('status')).toHaveTextContent('Checking page availability…')
    expect(screen.queryByRole('heading', { name: 'Why ScheduleShare' })).not.toBeInTheDocument()
  })

  it('fails closed when the visibility check cannot be loaded', async () => {
    mocks.getWhyScheduleShareEnabled.mockRejectedValue(new Error('network unavailable'))
    renderRoute()

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Why ScheduleShare' })).not.toBeInTheDocument()
  })
})
