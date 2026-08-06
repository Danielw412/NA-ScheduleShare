import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddClassDialog } from './AddClassDialog'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useClassSearch: vi.fn(),
  useCourseNameSearch: vi.fn(),
  createClassAndEnroll: vi.fn(),
  createClassAndReplaceEnrollment: vi.fn(),
  enrollInClass: vi.fn(),
  replaceEnrollment: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../hooks/useClassSearch', () => ({ useClassSearch: mocks.useClassSearch }))
vi.mock('../../hooks/useCourseNameSearch', () => ({ useCourseNameSearch: mocks.useCourseNameSearch }))
vi.mock('../../lib/supabase/data', () => ({
  classFromSearch: (result: Record<string, unknown>) => result,
  createClassAndEnroll: mocks.createClassAndEnroll,
  createClassAndReplaceEnrollment: mocks.createClassAndReplaceEnrollment,
  enrollInClass: mocks.enrollInClass,
  replaceEnrollment: mocks.replaceEnrollment,
  searchClasses: vi.fn(),
}))

function renderDialog() {
  render(<AddClassDialog
    open
    dayType="A"
    period={3}
    semester="semester_1"
    onClose={vi.fn()}
    onChanged={vi.fn(async () => undefined)}
    onDemoAdd={vi.fn()}
  />)
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ isDemo: false })
  mocks.useClassSearch.mockReturnValue({
    error: null,
    loading: false,
    results: [{
      id: 'class-lunch',
      course_name_id: 'course-lunch',
      course_name: 'Lunch - NASH',
      course_term_policy: 'lunch',
      teacher_last_name: 'N/A',
      default_academic_term: 'semester_1',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
      score: 100,
    }],
  })
  mocks.useCourseNameSearch.mockReturnValue({
    error: null,
    loading: false,
    results: [{ id: 'course-lunch', course_name: 'Lunch - NASH', course_term_policy: 'lunch', score: 100 }],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AddClassDialog Lunch defaults', () => {
  it('defaults an existing Lunch section to Full Year when adding it', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByText('Lunch - NASH'))

    expect(screen.getByRole('combobox', { name: 'Academic term' })).toHaveValue('full_year')
  })

  it('defaults a newly created Lunch section to Full Year', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Lunch - NASH' }))

    expect(screen.getByRole('combobox', { name: 'Academic term' })).toHaveValue('full_year')
  })
})
