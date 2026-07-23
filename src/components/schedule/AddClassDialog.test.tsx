import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseNameSearchResult, ScheduleEnrollment } from '../../lib/domain'
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

const catalog: CourseNameSearchResult[] = [
  { id: 'course-physics', course_name: 'Academic Physics', course_term_policy: 'full_year', score: 100 },
  { id: 'course-writing', course_name: 'Creative Writing', course_term_policy: 'semester', score: 99 },
  { id: 'course-gym', course_name: 'Gym', course_term_policy: 'flexible_attendance', score: 98 },
  { id: 'course-lunch', course_name: 'Lunch - NASH', course_term_policy: 'lunch', score: 97 },
  { id: 'course-study-hall', course_name: 'Study Hall - NASH', course_term_policy: 'flexible_attendance', score: 96 },
]

function renderDialog(replacing?: ScheduleEnrollment) {
  const onChanged = vi.fn(async () => undefined)
  render(<AddClassDialog
    open
    dayType="A"
    period={3}
    semester="semester_1"
    replacing={replacing}
    onClose={vi.fn()}
    onChanged={onChanged}
    onDemoAdd={vi.fn()}
  />)
  return { onChanged }
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ isDemo: false })
  mocks.useClassSearch.mockReturnValue({ error: null, loading: false, results: [] })
  mocks.useCourseNameSearch.mockReturnValue({ error: null, loading: false, results: catalog })
  mocks.createClassAndEnroll.mockResolvedValue('enrollment-new')
  mocks.createClassAndReplaceEnrollment.mockResolvedValue('enrollment-replacement')
  mocks.enrollInClass.mockResolvedValue('enrollment-existing')
  mocks.replaceEnrollment.mockResolvedValue('enrollment-replacement')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AddClassDialog semester formats', () => {
  it('shows semester selection only for a listed half-credit course', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))

    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))
    expect(screen.getByText('Full Year', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Semester' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Creative Writing' }))
    const semester = screen.getByRole('combobox', { name: 'Semester' })
    expect(semester).toHaveValue('semester_1')
    expect([...semester.querySelectorAll('option')].map((option) => option.value)).toEqual(['semester_1', 'semester_2'])
  })

  it('creates a full-year B-day-only Gym enrollment without duplicating its course format', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Gym' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'full_year_B')
    await user.selectOptions(screen.getByRole('combobox', { name: 'B day period' }), '5')
    await user.type(screen.getByRole('textbox', { name: /^Teacher Last Name/ }), 'Coach')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-gym',
      term: 'full_year',
      meetingSlots: [{ day_type: 'B', period_number: 5 }],
    })))
  })

  it('creates semester-specific Lunch on both A and B days in one period', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Lunch - NASH' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Academic term' }), 'semester_2')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '8')
    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-lunch',
      teacherLastName: 'N/A',
      term: 'semester_2',
      meetingSlots: [{ day_type: 'A', period_number: 8 }, { day_type: 'B', period_number: 8 }],
    })))
  })

  it('submits Full Year Lunch for expansion into both semester enrollments', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Lunch - NASH' }))
    expect(screen.getByText('Full Year adds matching Semester 1 and Semester 2 lunch entries at this period.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Academic term' }), 'full_year')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '8')
    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-lunch',
      teacherLastName: 'N/A',
      term: 'full_year',
      meetingSlots: [{ day_type: 'A', period_number: 8 }, { day_type: 'B', period_number: 8 }],
    })))
  })


  it('automatically uses N/A for Study Hall teachers', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Study Hall - NASH' }))

    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher Last Name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-study-hall',
      teacherLastName: 'N/A',
    })))
  })

  it('edits a student-specific Gym pattern on the existing shared class', async () => {
    const user = userEvent.setup()
    const replacing: ScheduleEnrollment = {
      id: 'enrollment-gym',
      class_id: 'class-gym',
      student_id: 'student-1',
      academic_term: 'full_year',
      active: true,
      created_at: '2026-07-23T00:00:00Z',
      updated_at: '2026-07-23T00:00:00Z',
      meeting_slots: [{ day_type: 'B', period_number: 5 }],
      class: {
        id: 'class-gym',
        course_name_id: 'course-gym',
        course_name: 'Gym',
        course_term_policy: 'flexible_attendance',
        teacher_last_name: 'Coach',
        default_academic_term: 'semester_1',
        is_double_period: false,
        meeting_slots: [{ day_type: 'A', period_number: 5 }, { day_type: 'B', period_number: 5 }],
      },
    }
    renderDialog(replacing)

    expect(screen.getByRole('combobox', { name: 'Format' })).toHaveValue('full_year_B')
    await user.click(screen.getByRole('button', { name: 'Save class entry' }))

    await waitFor(() => expect(mocks.replaceEnrollment).toHaveBeenCalledWith(
      'enrollment-gym',
      'class-gym',
      'full_year',
      [{ day_type: 'B', period_number: 5 }],
    ))
    expect(mocks.createClassAndEnroll).not.toHaveBeenCalled()
  })
})
