import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhyScheduleSharePage } from './WhyScheduleSharePage'

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))

function renderPage() {
  return render(<MemoryRouter><WhyScheduleSharePage /></MemoryRouter>)
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ user: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WhyScheduleSharePage', () => {
  it('makes the guest comparison scannable and offers screenshot importing', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Why ScheduleShare beats Saturn at NA.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Screenshot in. Schedule out.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your schedule means your actual schedule.' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Upload My Schedule/ })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /Upload My Schedule/ })[0]).toHaveAttribute('href', '/schedule?import=1')
  })

  it('removes upload calls to action for signed-in students', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' } })
    renderPage()

    expect(screen.queryByRole('link', { name: /Upload My Schedule/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Privacy has real controls.' })).toBeInTheDocument()
  })
})
