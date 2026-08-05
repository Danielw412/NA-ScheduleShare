import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhyScheduleSharePage } from './WhyScheduleSharePage'

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage(initialEntries = ['/why-scheduleshare'], initialIndex?: number) {
  return render(<MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}><WhyScheduleSharePage /><LocationProbe /></MemoryRouter>)
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

    expect(screen.getByRole('heading', { name: 'Why ScheduleShare over Saturn' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'The case, without the notification campaign' })).not.toBeInTheDocument()
    expect(screen.queryByText('Eight reasons. Zero popups asking you to invite eight friends before you can read them.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Just need a screenshot' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trick your counselor' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your actual schedule' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No notifications!' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.queryByText('PowerSchool already did the typing. We let it keep the job.')).not.toBeInTheDocument()
    expect(screen.queryByText('Your schedule is social only when you say so.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Upload My Schedule/ })).toHaveAttribute('href', '/schedule?import=1')
  })

  it('removes upload calls to action for signed-in students', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' } })
    renderPage()

    expect(screen.queryByRole('link', { name: /Upload My Schedule/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Anti-stalking' })).toBeInTheDocument()
  })

  it('returns to the previous page from the top back button', () => {
    renderPage(['/', '/why-scheduleshare'], 1)

    screen.getAllByRole('button', { name: 'Back' })[0].click()

    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('returns to the previous page from the bottom back button', () => {
    renderPage(['/', '/why-scheduleshare'], 1)

    screen.getAllByRole('button', { name: 'Back' })[1].click()

    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })
})
