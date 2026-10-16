import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiscoveryGate } from './DiscoveryGate'

const mocks = vi.hoisted(() => ({ useSchedule: vi.fn() }))
vi.mock('../../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiscoveryGate', () => {
  it('gives signed-in students without a schedule the upload action', () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
    render(<MemoryRouter><DiscoveryGate><p>Private discovery</p></DiscoveryGate></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Add your schedule to find classmates' })).toBeInTheDocument()
    expect(screen.getByText(/privacy settings still apply/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload schedule' })).toHaveAttribute('href', '/schedule?import=1')
    expect(screen.queryByText('Private discovery')).not.toBeInTheDocument()
  })

  it('waits for the schedule before deciding', () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [], loading: true })
    render(<MemoryRouter><DiscoveryGate><p>Private discovery</p></DiscoveryGate></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Checking your schedule…')
    expect(screen.queryByText('Private discovery')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload schedule' })).not.toBeInTheDocument()
  })

  it('shows discovery once the student has a class', () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [{ id: 'enrollment-1' }], loading: false })
    render(<MemoryRouter><DiscoveryGate><p>Private discovery</p></DiscoveryGate></MemoryRouter>)
    expect(screen.getByText('Private discovery')).toBeInTheDocument()
  })
})
