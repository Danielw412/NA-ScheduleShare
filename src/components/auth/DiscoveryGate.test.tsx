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
    expect(screen.getByRole('heading', { name: 'Upload your schedule to see which classmates share your courses.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload Schedule' })).toHaveAttribute('href', '/schedule?import=1')
    expect(screen.queryByText('Private discovery')).not.toBeInTheDocument()
  })
})
