import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(screen.getByText('Alex Morgan').closest('a')).toHaveAttribute('href', '/students/public-student')
    expect(screen.queryByText('View schedule')).not.toBeInTheDocument()
  })

  it('keeps search visible while secondary filters collapse and clear as chips', async () => {
    const user = userEvent.setup()
    mocks.searchStudentDirectory.mockResolvedValue([])
    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(screen.getByPlaceholderText('Student name')).toBeInTheDocument()
    const filterToggle = screen.getByRole('button', { name: 'Filters' })
    await user.click(filterToggle)
    expect(filterToggle).toHaveAttribute('aria-expanded', 'true')

    await user.selectOptions(screen.getByLabelText('Grade'), '11')
    await user.type(screen.getByLabelText('Course'), 'Chemistry')
    await user.type(screen.getByLabelText('Teacher Last Name'), 'Green')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Grade 11')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Chemistry')
    expect(screen.getByLabelText('Active student filters')).toHaveTextContent('Green')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByLabelText('Active student filters')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Grade')).toHaveValue('')
    expect(screen.getByLabelText('Course')).toHaveValue('')
    expect(screen.getByLabelText('Teacher Last Name')).toHaveValue('')
  })
})
