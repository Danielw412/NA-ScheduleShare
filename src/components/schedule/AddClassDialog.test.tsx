import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassSearchResult, CourseNameSearchResult, ScheduleEnrollment } from '../../lib/domain'
import { getCssDeclarations } from '../../test/css'
import styles from '../../styles/features/schedule-dialogs.css?raw'
import { AddClassDialog } from './AddClassDialog'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useClassSearch: vi.fn(),
  useCourseNameSearch: vi.fn(),
  createClassAndEnroll: vi.fn(),
  createClassAndReplaceEnrollment: vi.fn(),
  enrollInClass: vi.fn(),
  replaceEnrollment: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../../hooks/useClassSearch', () => ({ useClassSearch: mocks.useClassSearch }))
vi.mock('../../hooks/useCourseNameSearch', () => ({ useCourseNameSearch: mocks.useCourseNameSearch }))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
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
  { id: 'course-wellness', course_name: 'Wellness for Life', course_term_policy: 'sectioned_attendance', score: 95 },
]

function specialResult(overrides: Partial<ClassSearchResult>): ClassSearchResult {
  return {
    id: 'class-special',
    course_name_id: 'course-special',
    course_name: 'Special',
    course_term_policy: 'flexible_attendance',
    teacher_last_name: 'N/A',
    default_academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 3 }],
    score: 100,
    ...overrides,
  }
}

function renderDialog(replacing?: ScheduleEnrollment) {
  const onChanged = vi.fn(async () => undefined)
  const onClose = vi.fn()
  render(<AddClassDialog
    open
    dayType="A"
    period={3}
    semester="semester_1"
    replacing={replacing}
    onClose={onClose}
    onChanged={onChanged}
    onDemoAdd={vi.fn()}
  />)
  return { onChanged, onClose }
}

/** Mounts the dialog only while open, from a real trigger, as SchedulePage does. */
function DialogWithTrigger() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Add class to period 3</button>
    {open ? <AddClassDialog open dayType="A" period={3} semester="semester_1" onClose={() => setOpen(false)} onChanged={vi.fn(async () => undefined)} onDemoAdd={vi.fn()} /> : null}
  </>
}

/** Emulates a phone: a coarse pointer on a narrow screen. */
function stubPhoneMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function editingEnrollment(): ScheduleEnrollment {
  return {
    id: 'enrollment-physics',
    class_id: 'class-physics',
    student_id: 'student-1',
    academic_term: 'full_year',
    active: true,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    class: {
      id: 'class-physics',
      course_name_id: 'course-physics',
      course_name: 'Academic Physics',
      course_term_policy: 'full_year',
      teacher_last_name: 'Kim',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 3 }],
    },
  }
}

function resultRows(): HTMLElement[] {
  return screen.getAllByRole('radio').map((radio) => radio.closest('.add-class-result') as HTMLElement)
}

function periodNumeral(row: HTMLElement): string | null | undefined {
  return row.querySelector('.period-numeral')?.textContent
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
  vi.unstubAllGlobals()
})

describe('AddClassDialog semester formats', () => {
  it('renders in the shared dialog with the slot context and keeps Add class disabled until a section is chosen', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('dialog', 'add-class-dialog')
    expect(screen.getByRole('heading', { name: 'Add a class' })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription('Period 3 on A days in Semester 1')
    expect(screen.getByRole('button', { name: 'Add class' })).toBeDisabled()
    expect(screen.getByText('Choose a section to continue.')).toBeInTheDocument()
  })

  it('shows period numerals, teachers, day facts, and terms for sections but no term for grouped special courses', () => {
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [
        specialResult({ id: 'full-year-result', course_name: 'Academic Physics', teacher_last_name: 'Kim', course_term_policy: 'full_year', default_academic_term: 'full_year', meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }] }),
        specialResult({ id: 'semester-result', course_name: 'Honors Music Production 3', teacher_last_name: 'Tozier', course_term_policy: 'semester', default_academic_term: 'semester_2' }),
        specialResult({ id: 'study-hall-result', course_name_id: 'course-study-hall', course_name: 'Study Hall - NASH', course_term_policy: 'flexible_attendance', default_academic_term: 'semester_1' }),
      ],
    })

    renderDialog()

    const [physics, music, studyHall] = resultRows()
    expect(periodNumeral(physics)).toBe('3')
    expect(within(physics).getByText('Kim')).toBeInTheDocument()
    expect(within(physics).getByText('Every day')).toHaveClass('chip')
    expect(within(physics).getByText('Full year')).toHaveClass('add-class-result-term')
    expect(within(music).getByText('A days only')).toBeInTheDocument()
    expect(within(music).getByText('Semester 2')).toHaveClass('add-class-result-term')
    expect(within(studyHall).queryByText('N/A')).not.toBeInTheDocument()
    expect(studyHall.querySelector('.add-class-result-term')).toBeNull()
    expect(within(studyHall).getByText('Choose your days and term next')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()
  })

  it('shows loading, empty, and search-error states for the section search', () => {
    mocks.useClassSearch.mockReturnValue({ error: null, loading: true, results: [] })
    const { unmount } = render(<AddClassDialog open dayType="A" period={3} semester="semester_1" onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} onDemoAdd={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Searching for classes…')
    unmount()

    mocks.useClassSearch.mockReturnValue({ error: null, loading: false, results: [] })
    renderDialog()
    expect(screen.getByText(/No sections match this semester and period/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a new class' })).toBeInTheDocument()
    cleanup()

    mocks.useClassSearch.mockReturnValue({ error: 'Class search is temporarily unavailable. Please try again.', loading: false, results: [] })
    renderDialog()
    expect(screen.getByRole('alert')).toHaveTextContent('Class search is temporarily unavailable')
  })

  it('adds a selected section, confirms with a toast, and closes', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [specialResult({ id: 'class-physics', course_name: 'Academic Physics', teacher_last_name: 'Kim', course_term_policy: 'full_year', default_academic_term: 'full_year', meeting_slots: [{ day_type: 'A', period_number: 3 }] })],
    })
    const { onChanged, onClose } = renderDialog()

    await user.click(screen.getByRole('radio', { name: /Academic Physics/ }))
    expect(screen.getByRole('radio', { name: /Academic Physics/ }).closest('.add-class-result')).toHaveClass('is-selected')
    expect(screen.getByRole('heading', { name: 'How you attend' })).toBeInTheDocument()
    expect(document.querySelector('.add-class-footer-summary')).toHaveTextContent('Academic Physics with Kim')
    await user.click(screen.getByRole('button', { name: 'Add class' }))

    await waitFor(() => expect(mocks.enrollInClass).toHaveBeenCalledWith('class-physics', 'full_year', [{ day_type: 'A', period_number: 3 }]))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('Added Academic Physics to your schedule.')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps a conflict error next to the add action and leaves the dialog open', async () => {
    const user = userEvent.setup()
    mocks.enrollInClass.mockRejectedValue(new Error('schedule_conflict'))
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [specialResult({ id: 'class-physics', course_name: 'Academic Physics', course_term_policy: 'full_year', default_academic_term: 'full_year' })],
    })
    const { onClose } = renderDialog()

    await user.click(screen.getByRole('radio', { name: /Academic Physics/ }))
    await user.click(screen.getByRole('button', { name: 'Add class' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This entry conflicts with another class or lunch in the same semester and day.')
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('shows one shared period dropdown for a normal class that meets on both days', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))

    expect(screen.getByRole('combobox', { name: 'Meeting days' })).toHaveValue('both')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('3')
    expect(screen.queryByRole('combobox', { name: 'A day period' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'B day period' })).not.toBeInTheDocument()
  })

  it('shows semester selection only for a listed half-credit course', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))

    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))
    expect(screen.getByText('Full year', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Semester' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Creative Writing' }))
    const semester = screen.getByRole('radiogroup', { name: 'Semester' })
    expect(within(semester).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['semester_1', 'semester_2'])
    expect(within(semester).getByRole('radio', { name: 'Semester 1' })).toBeChecked()

    await user.click(within(semester).getByRole('radio', { name: 'Semester 2' }))
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Chen')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))
    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-writing',
      term: 'semester_2',
    })))
  })

  it('requires confirmation before creating a course that is not in the catalog', async () => {
    const user = userEvent.setup()
    mocks.useCourseNameSearch.mockReturnValue({ error: null, loading: false, results: [] })
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    expect(screen.getByRole('heading', { name: 'Create a class' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Course name'), 'Robotics Engineering')
    expect(screen.getByText('No catalog course matches “Robotics Engineering”.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Nguyen')
    expect(screen.getByRole('button', { name: 'Create and add class' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Create “Robotics Engineering” as a new course/ }))
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))
    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: undefined,
      newCourseName: 'Robotics Engineering',
      teacherLastName: 'Nguyen',
      term: 'full_year',
      confirmedNoCourseMatch: true,
    })))
  })

  it('returns from the create form to section search', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Back to search' }))
    expect(screen.getByRole('heading', { name: 'Add a class' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search by course or teacher' })).toBeInTheDocument()
  })

  it('creates a full-year B-day-only Gym enrollment without duplicating its course format', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Gym' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'full_year_B')
    await user.selectOptions(screen.getByRole('combobox', { name: 'B day period' }), '5')
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Coach')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-gym',
      term: 'full_year',
      meetingSlots: [{ day_type: 'B', period_number: 5 }],
    })))
  })

  it('groups Gym by course, teacher, and period while keeping other teachers and periods separate', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [
        specialResult({ id: 'gym-coach-a', course_name_id: 'course-gym', course_name: 'Gym', teacher_last_name: 'Coach', meeting_slots: [{ day_type: 'A', period_number: 3 }] }),
        specialResult({ id: 'gym-coach-b', course_name_id: 'course-gym', course_name: 'Gym', teacher_last_name: 'Coach', meeting_slots: [{ day_type: 'B', period_number: 3 }] }),
        specialResult({ id: 'gym-coach-semester', course_name_id: 'course-gym', course_name: 'Gym', teacher_last_name: 'Coach', default_academic_term: 'semester_1', meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }] }),
        specialResult({ id: 'gym-trainer', course_name_id: 'course-gym', course_name: 'Gym', teacher_last_name: 'Trainer', meeting_slots: [{ day_type: 'A', period_number: 3 }] }),
        specialResult({ id: 'gym-coach-p4', course_name_id: 'course-gym', course_name: 'Gym', teacher_last_name: 'Coach', meeting_slots: [{ day_type: 'A', period_number: 4 }] }),
      ],
    })
    renderDialog()

    const rows = resultRows()
    expect(rows).toHaveLength(3)
    expect(rows.filter((result) => within(result).queryByText('Coach'))).toHaveLength(2)
    expect(rows.filter((result) => within(result).queryByText('Trainer'))).toHaveLength(1)
    expect(rows.filter((result) => periodNumeral(result) === '3')).toHaveLength(2)
    expect(rows.filter((result) => periodNumeral(result) === '4')).toHaveLength(1)

    const coachPeriodThree = rows.find((result) => within(result).queryByText('Coach') && periodNumeral(result) === '3')
    const coachPeriodFour = rows.find((result) => within(result).queryByText('Coach') && periodNumeral(result) === '4')
    expect(coachPeriodThree).toBeDefined()
    expect(coachPeriodFour).toBeDefined()
    await user.click(within(coachPeriodFour!).getByRole('radio'))
    expect(screen.getByText('4', { selector: '.add-class-fixed-period strong' })).toBeInTheDocument()
    await user.click(within(coachPeriodThree!).getByRole('radio'))
    expect(screen.getByRole('combobox', { name: 'Format' })).toHaveValue('semester_1')
    expect(screen.queryByRole('combobox', { name: 'Period' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'full_year_B')
    await user.click(screen.getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(mocks.enrollInClass).toHaveBeenCalledWith(
      'gym-coach-semester',
      'full_year',
      [{ day_type: 'B', period_number: 3 }],
    ))
  })

  it('uses one period selector for semester Gym and writes the period to both days', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Gym' }))

    expect(screen.getByRole('combobox', { name: 'Format' })).toHaveValue('semester_1')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('3')
    expect(screen.queryByRole('combobox', { name: 'A day period' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'B day period' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '6')
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Coach')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-gym',
      term: 'semester_1',
      meetingSlots: [{ day_type: 'A', period_number: 6 }, { day_type: 'B', period_number: 6 }],
    })))
  })

  it('offers the same four formats when creating an exact Wellness section', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Wellness for Life' }))

    expect([...screen.getByRole('combobox', { name: 'Format' }).querySelectorAll('option')].map((option) => option.value)).toEqual([
      'semester_1', 'semester_2', 'full_year_A', 'full_year_B',
    ])
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument()
  })

  it('collapses semester-specific Lunch sections into one period-only search result', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [
        specialResult({
          id: 'lunch-semester-2',
          course_name_id: 'course-lunch',
          course_name: 'Lunch - NASH',
          course_term_policy: 'lunch',
          default_academic_term: 'semester_2',
          meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
        }),
        specialResult({
          id: 'lunch-semester-1',
          course_name_id: 'course-lunch',
          course_name: 'Lunch - NASH',
          course_term_policy: 'lunch',
          default_academic_term: 'semester_1',
          meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
        }),
      ],
    })
    renderDialog()

    expect(screen.getAllByRole('radio')).toHaveLength(1)
    const result = screen.getByText('Lunch - NASH').closest('label')
    expect(result).not.toBeNull()
    expect(periodNumeral(result as HTMLElement)).toBe('3')
    expect(within(result as HTMLElement).queryByText('Semester 1')).not.toBeInTheDocument()
    expect(within(result as HTMLElement).queryByText('Semester 2')).not.toBeInTheDocument()
    expect(within(result as HTMLElement).getByText('Choose your term next')).toBeInTheDocument()

    await user.click(screen.getByText('Lunch - NASH'))
    expect(screen.queryByRole('combobox', { name: 'Period' })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('radiogroup', { name: 'Academic term' })).getByRole('radio', { name: 'Semester 2' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Academic term' })).getByRole('radio', { name: 'Full year' }))
    await user.click(screen.getByRole('button', { name: 'Add class' }))

    await waitFor(() => expect(mocks.enrollInClass).toHaveBeenCalledWith(
      'lunch-semester-1',
      'full_year',
      [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
    ))
  })

  it('creates semester-specific Lunch on both A and B days at the selected schedule period', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Lunch - NASH' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Academic term' })).getByRole('radio', { name: 'Semester 2' }))
    expect(screen.queryByRole('combobox', { name: 'Period' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-lunch',
      teacherLastName: 'N/A',
      term: 'semester_2',
      meetingSlots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
    })))
  })

  it('submits Full Year Lunch for expansion into both semester enrollments', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Lunch - NASH' }))
    expect(screen.getByText('Full year adds matching Semester 1 and Semester 2 lunch entries.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('radiogroup', { name: 'Academic term' })).getByRole('radio', { name: 'Full year' }))
    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-lunch',
      teacherLastName: 'N/A',
      term: 'full_year',
      meetingSlots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
    })))
  })

  it('collapses Study Hall variants and lets the student choose one attendance format', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      error: null,
      loading: false,
      results: [
        specialResult({
          id: 'study-hall-b',
          course_name_id: 'course-study-hall',
          course_name: 'Study Hall - NASH',
          default_academic_term: 'full_year',
          meeting_slots: [{ day_type: 'B', period_number: 3 }],
        }),
        specialResult({
          id: 'study-hall-a',
          course_name_id: 'course-study-hall',
          course_name: 'Study Hall - NASH',
          default_academic_term: 'full_year',
          meeting_slots: [{ day_type: 'A', period_number: 3 }],
        }),
        specialResult({
          id: 'study-hall-semester-1',
          course_name_id: 'course-study-hall',
          course_name: 'Study Hall - NASH',
          default_academic_term: 'semester_1',
          meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
        }),
      ],
    })
    renderDialog()

    expect(screen.getAllByRole('radio')).toHaveLength(1)
    const result = screen.getByText('Study Hall - NASH').closest('label')
    expect(result).not.toBeNull()
    expect(periodNumeral(result as HTMLElement)).toBe('3')
    expect(within(result as HTMLElement).queryByText('A days only')).not.toBeInTheDocument()
    expect(within(result as HTMLElement).queryByText('B days only')).not.toBeInTheDocument()
    expect(within(result as HTMLElement).queryByText('Full year')).not.toBeInTheDocument()

    await user.click(screen.getByText('Study Hall - NASH'))
    expect(screen.getByRole('combobox', { name: 'Format' })).toHaveValue('semester_1')
    expect(screen.getByText('3', { selector: '.add-class-fixed-period strong' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'A day period' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'B day period' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Period' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'full_year_B')
    await user.click(screen.getByRole('button', { name: 'Add class' }))

    await waitFor(() => expect(mocks.enrollInClass).toHaveBeenCalledWith(
      'study-hall-semester-1',
      'full_year',
      [{ day_type: 'B', period_number: 3 }],
    ))
  })

  it('automatically uses N/A for Study Hall teachers', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Study Hall - NASH' }))

    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toHaveValue('N/A')
    expect(screen.getByRole('textbox', { name: /^Teacher last name/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({
      courseNameId: 'course-study-hall',
      teacherLastName: 'N/A',
      term: 'semester_1',
      meetingSlots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
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

  it('explains a class creation throttle instead of showing the raw backend error', async () => {
    const user = userEvent.setup()
    mocks.createClassAndEnroll.mockRejectedValue(new Error('rate_limit_exceeded'))
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Keats')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You have created many new class sections recently')
  })
})

describe('AddClassDialog focus and messages', () => {
  it('focuses the search field on desktop and returns focus to the Add class trigger on close', async () => {
    const user = userEvent.setup()
    render(<StrictMode><DialogWithTrigger /></StrictMode>)
    const trigger = screen.getByRole('button', { name: 'Add class to period 3' })
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Search by course or teacher' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('moves focus to the new form on desktop when switching between search and create', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    expect(screen.getByLabelText('Course name')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Back to search' }))
    expect(screen.getByRole('searchbox', { name: 'Search by course or teacher' })).toHaveFocus()
  })

  it('keeps focus in the dialog on phones when switching modes, without focusing a text field', async () => {
    stubPhoneMedia()
    const user = userEvent.setup()
    render(<StrictMode><DialogWithTrigger /></StrictMode>)
    const trigger = screen.getByRole('button', { name: 'Add class to period 3' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('searchbox', { name: 'Search by course or teacher' })).not.toHaveFocus()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    expect(screen.getByRole('heading', { name: 'Create a class' })).toBeInTheDocument()
    expect(dialog).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Back to search' }))
    expect(screen.getByRole('heading', { name: 'Add a class' })).toBeInTheDocument()
    expect(dialog).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('says Saved, not Added, when an edited entry is replaced by a newly created section', async () => {
    const user = userEvent.setup()
    renderDialog(editingEnrollment())
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Keats')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.createClassAndReplaceEnrollment).toHaveBeenCalledWith('enrollment-physics', expect.objectContaining({ courseNameId: 'course-physics', teacherLastName: 'Keats' })))
    expect(mocks.showToast).toHaveBeenCalledWith('Saved Academic Physics.')
  })

  it('still says Added when a newly created section is added to an empty period', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Create a new class' }))
    await user.click(screen.getByRole('button', { name: 'Academic Physics' }))
    await user.type(screen.getByRole('textbox', { name: /^Teacher last name/ }), 'Keats')
    await user.click(screen.getByRole('button', { name: 'Create and add class' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Added Academic Physics to your schedule.'))
  })
})

describe('AddClassDialog styles', () => {
  it('bounds the section list so the attendance step stays reachable', () => {
    expect(getCssDeclarations(styles, '.add-class-result-list')).toMatchObject({
      'max-height': 'min(328px, 40dvh)',
      'overflow-y': 'auto',
      'overscroll-behavior': 'contain',
    })
  })

  it('keeps result rows and catalog options at touch size', () => {
    expect(getCssDeclarations(styles, '.add-class-result')['min-height']).toBe('64px')
    expect(getCssDeclarations(styles, '.add-class-course-option, .schedule-import-course-option')['min-height']).toBe('48px')
  })
})
