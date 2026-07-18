import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as scheduleShare from '../lib/scheduleShare'
import { SharedSchedulePage } from './SharedSchedulePage'

const TOKEN = '99300000-0000-4000-8000-000000000001'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/share/${TOKEN}`]}>
      <Routes><Route path="share/:token" element={<SharedSchedulePage />} /></Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('shared schedule page', () => {
  it('renders a signed-out-safe read-only grid including period 9', async () => {
    vi.spyOn(scheduleShare, 'fetchPublicScheduleShare').mockResolvedValue({
      available: true,
      schedule: [{ day_type: 'A', period_number: 9, course_name: 'Robotics', academic_term: 'semester_1' }],
    })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Shared Schedule' })).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /Robotics/i })).toHaveAttribute('data-period', '9')
    expect(screen.queryByRole('button', { name: /Add class/i })).not.toBeInTheDocument()
  })

  it('shows a clear generic state for an invalid or disabled link', async () => {
    vi.spyOn(scheduleShare, 'fetchPublicScheduleShare').mockResolvedValue({ available: false, schedule: [] })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'This schedule isn’t available' })).toBeInTheDocument()
    expect(screen.getByText(/invalid, disabled, or no longer available/i)).toBeInTheDocument()
  })
})
