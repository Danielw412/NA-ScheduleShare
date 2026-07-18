import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudentsPage } from './StudentsPage'

const mocks = vi.hoisted(() => ({
  searchStudentDirectory: vi.fn(),
}))

vi.mock('../components/auth/DiscoveryGate', () => ({ DiscoveryGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/ui/ProfileAvatar', () => ({ ProfileAvatar: ({ fullName }: { fullName: string }) => <span aria-label={`${fullName} avatar`} /> }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false }) }))
vi.mock('../lib/supabase/data', () => ({ searchStudentDirectory: mocks.searchStudentDirectory }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StudentsPage privacy display', () => {
  it('shows masked private students without a schedule link', async () => {
    mocks.searchStudentDirectory.mockResolvedValue([
      { student_id: 'private-student', full_name: 'Jordan', grade: 11, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false },
      { student_id: 'public-student', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true },
    ])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(await screen.findByText('Jordan')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View schedule' })).toHaveAttribute('href', '/students/public-student')
  })
})
