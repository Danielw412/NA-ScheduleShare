import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import engineStyles from '../styles/features/engine.css?raw'
import { getCssDeclarations } from '../test/css'
import type { ScheduleEngineJob, ScheduleEnginePredictedEnrollment, ScheduleEnrollment } from '../lib/domain'
import { ScheduleEnginePage } from './ScheduleEnginePage'

const mocks = vi.hoisted(() => ({
  useSchedule: vi.fn(),
  useCourseNameSearch: vi.fn(),
  createScheduleEngineJob: vi.fn(),
  listScheduleEngineJobs: vi.fn(),
  cancelScheduleEngineJob: vi.fn(),
  applyScheduleEnginePrediction: vi.fn(),
  reloadSchedule: vi.fn(),
}))

vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../hooks/useCourseNameSearch', () => ({ useCourseNameSearch: mocks.useCourseNameSearch }))
vi.mock('../lib/supabase/data', () => ({
  createScheduleEngineJob: mocks.createScheduleEngineJob,
  listScheduleEngineJobs: mocks.listScheduleEngineJobs,
  cancelScheduleEngineJob: mocks.cancelScheduleEngineJob,
  applyScheduleEnginePrediction: mocks.applyScheduleEnginePrediction,
}))

const english: ScheduleEnrollment = {
  id: 'enrollment-english',
  student_id: 'student-1',
  class_id: 'class-english',
  academic_term: 'full_year',
  active: true,
  created_at: '2026-08-01T12:00:00Z',
  updated_at: '2026-08-01T12:00:00Z',
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  class: {
    id: 'class-english',
    course_name_id: 'course-english',
    course_name: 'AP English Language',
    teacher_last_name: 'Carter',
    default_academic_term: 'full_year',
    course_term_policy: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  },
}

const chemistry: ScheduleEnrollment = {
  ...english,
  id: 'enrollment-chemistry',
  class_id: 'class-chemistry',
  class: {
    ...english.class,
    id: 'class-chemistry',
    course_name_id: 'course-chemistry',
    course_name: 'Chemistry',
    teacher_last_name: 'Patel',
    meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
  },
  meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
}

const biology: ScheduleEnrollment = {
  ...chemistry,
  id: 'enrollment-biology',
  class_id: 'class-biology',
  class: {
    ...chemistry.class,
    id: 'class-biology',
    course_name_id: 'course-biology',
    course_name: 'Biology',
    teacher_last_name: 'Nguyen',
    meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
  },
  meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
}

const fillerEnrollments: ScheduleEnrollment[] = Array.from({ length: 6 }, (_, index) => {
  const period = index + 4
  return {
    ...english,
    id: `enrollment-filler-${period}`,
    class_id: `class-filler-${period}`,
    meeting_slots: [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }],
    class: {
      ...english.class,
      id: `class-filler-${period}`,
      course_name_id: `course-filler-${period}`,
      course_name: `Sample Class ${period}`,
      teacher_last_name: `Teacher${period}`,
      meeting_slots: [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }],
    },
  }
})

const completeSchedule = [english, chemistry, biology, ...fillerEnrollments]

function unchanged(enrollment: ScheduleEnrollment): ScheduleEnginePredictedEnrollment {
  return { ...enrollment, changedFromEnrollmentId: null }
}

const literatureInPeriodOne: ScheduleEnginePredictedEnrollment = {
  ...english,
  id: 'prediction-literature',
  class_id: 'class-literature',
  changedFromEnrollmentId: english.id,
  class: { ...english.class, id: 'class-literature', course_name_id: 'course-literature', course_name: 'AP Literature', teacher_last_name: 'Brooks' },
}

function baseJob(overrides: Partial<ScheduleEngineJob>): ScheduleEngineJob {
  return {
    id: 'job-base',
    status: 'queued',
    emailNotification: true,
    notificationStatus: 'pending',
    queuedAt: '2026-08-01T12:00:00Z',
    processingStartedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    errorMessage: null,
    noValidScheduleReason: null,
    createdAt: '2026-08-01T12:00:00Z',
    updatedAt: '2026-08-01T12:00:00Z',
    sourceCourses: [{ position: 1, enrollmentId: english.id, courseId: 'course-english', courseName: 'AP English Language' }],
    replacementCourses: [{ position: 1, courseId: 'course-literature', courseName: 'AP Literature' }],
    predictions: [],
    ...overrides,
  }
}

function completedJob(): ScheduleEngineJob {
  // Option 2 puts Literature in period 3 and moves Biology to period 1.
  const literatureInPeriodThree: ScheduleEnginePredictedEnrollment = {
    ...literatureInPeriodOne,
    id: 'prediction-literature-3',
    class_id: 'class-literature-3',
    meeting_slots: biology.meeting_slots,
    class: { ...literatureInPeriodOne.class, id: 'class-literature-3', teacher_last_name: 'Ellis', meeting_slots: biology.class.meeting_slots },
  }
  const biologyInPeriodOne: ScheduleEnginePredictedEnrollment = {
    ...biology,
    id: 'prediction-biology-1',
    class_id: 'class-biology-1',
    changedFromEnrollmentId: biology.id,
    meeting_slots: english.meeting_slots,
    class: { ...biology.class, id: 'class-biology-1', teacher_last_name: 'Ortiz', meeting_slots: english.class.meeting_slots },
  }
  return baseJob({
    id: 'job-complete',
    status: 'completed',
    processingStartedAt: '2026-08-01T12:10:00Z',
    completedAt: '2026-08-01T12:20:00Z',
    updatedAt: '2026-08-01T12:20:00Z',
    predictions: [{
      rank: 1,
      developmentPlaceholder: false,
      collateralChangeCount: 0,
      searchStage: 'direct_replacement',
      explanations: ['Requested change: dropped AP English Language and added AP Literature using an existing section.'],
      schedule: [literatureInPeriodOne, ...[chemistry, biology, ...fillerEnrollments].map(unchanged)],
    }, {
      rank: 2,
      developmentPlaceholder: false,
      collateralChangeCount: 1,
      searchStage: 'one_collateral_change',
      explanations: [],
      schedule: [biologyInPeriodOne, unchanged(chemistry), literatureInPeriodThree, ...fillerEnrollments.map(unchanged)],
    }],
  })
}

function renderPage() {
  return render(<MemoryRouter><ToastProvider><ScheduleEnginePage /></ToastProvider></MemoryRouter>)
}

async function pickCatalogCourse(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, query: string, option: string) {
  await user.type(input, query)
  const row = input.closest<HTMLElement>('.engine-add-row')!
  await user.click(within(row).getByRole('option', { name: option }))
}

beforeEach(() => {
  mocks.useSchedule.mockReturnValue({ enrollments: completeSchedule, loading: false, error: null, reload: mocks.reloadSchedule })
  mocks.useCourseNameSearch.mockReturnValue({
    loading: false,
    error: null,
    results: [
      { id: 'course-english', course_name: 'AP English Language', course_term_policy: 'full_year', score: 100 },
      { id: 'course-literature', course_name: 'AP Literature', course_term_policy: 'full_year', score: 95 },
      { id: 'course-history', course_name: 'AP US History', course_term_policy: 'full_year', score: 90 },
      { id: 'course-economics', course_name: 'AP Economics', course_term_policy: 'full_year', score: 85 },
      { id: 'course-study-hall', course_name: 'Study Hall - NASH', course_term_policy: 'flexible_attendance', score: 80 },
    ],
  })
  mocks.listScheduleEngineJobs.mockResolvedValue([])
  mocks.cancelScheduleEngineJob.mockResolvedValue(undefined)
  mocks.createScheduleEngineJob.mockResolvedValue('job-1')
  mocks.applyScheduleEnginePrediction.mockResolvedValue(3)
  mocks.reloadSchedule.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ScheduleEnginePage request form', () => {
  it('submits catalog and enrollment IDs only after a valid replacement is complete', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })

    const submit = screen.getByRole('button', { name: 'Find schedules' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await user.type(screen.getByRole('combobox', { name: 'Course to add' }), 'AP Lit')

    // A course can't replace itself, so the dropped course is not offered.
    expect(screen.queryByRole('option', { name: 'AP English Language' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'AP Literature' }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english'],
      replacementCourseIds: ['course-literature'],
    }, true))
    expect(await screen.findByText('Request sent. It’s waiting in line.')).toBeInTheDocument()
  })

  it('sends the email preference the student chose', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    await user.click(screen.getByRole('checkbox', { name: /Email me when my options are ready/ }))
    await user.click(screen.getByRole('button', { name: 'Find schedules' }))
    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith(expect.anything(), false))
  })

  it('supports three independent current courses and three independent replacement courses', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await user.click(screen.getByRole('checkbox', { name: /Chemistry/ }))
    await user.click(screen.getByRole('checkbox', { name: /Biology/ }))
    // Three is the limit: every other class is locked until one is unchecked.
    expect(screen.getByRole('checkbox', { name: /Sample Class 4/ })).toBeDisabled()
    expect(screen.getByText(/You can drop up to three courses/)).toBeInTheDocument()

    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    await user.click(screen.getByRole('button', { name: 'Add another course' }))
    const secondInput = screen.getAllByRole('combobox', { name: /Course to add/ })[1]
    await user.type(secondInput, 'History')
    const secondRow = secondInput.closest<HTMLElement>('.engine-add-row')!
    expect(within(secondRow).queryByRole('option', { name: 'AP Literature' })).not.toBeInTheDocument()
    await user.click(within(secondRow).getByRole('option', { name: 'AP US History' }))
    await user.click(screen.getByRole('button', { name: 'Add another course' }))
    await pickCatalogCourse(user, screen.getAllByRole('combobox', { name: /Course to add/ })[2], 'Economics', 'AP Economics')
    expect(screen.queryByRole('button', { name: 'Add another course' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Find schedules' }))

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english', 'enrollment-chemistry', 'enrollment-biology'],
      replacementCourseIds: ['course-literature', 'course-history', 'course-economics'],
    }, true))
  })

  it('removes an added course row', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    await user.click(screen.getByRole('button', { name: 'Add another course' }))
    expect(screen.getAllByRole('combobox', { name: /Course to add/ })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove AP Literature' }))
    expect(screen.getAllByRole('combobox', { name: 'Course to add' })).toHaveLength(1)
  })

  it('requires the current schedule to fill every A/B period in both semesters', async () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [english, chemistry, biology], loading: false, error: null, reload: mocks.reloadSchedule })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Fill every period first' })).toBeInTheDocument()
    expect(screen.getByText(/Semester 1, A day period 4 is empty/i)).toBeInTheDocument()
    expect(screen.getByText(/23 other periods need a fix too/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my schedule' })).toHaveAttribute('href', '/schedule')
    expect(screen.queryByRole('button', { name: 'Find schedules' })).not.toBeInTheDocument()
  })

  it('asks for classes when the schedule is empty', async () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false, error: null, reload: mocks.reloadSchedule })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Add your classes first' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find schedules' })).not.toBeInTheDocument()
  })

  it('shows a schedule load error with a retry', async () => {
    mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false, error: 'Unable to load the schedule.', reload: mocks.reloadSchedule })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the schedule.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.reloadSchedule).toHaveBeenCalled()
  })

  it('allows one Study Hall selection when the worker can expand it to two half-credit Study Halls', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Study', 'Study Hall - NASH')

    expect(screen.getByText('Credits can match')).toBeInTheDocument()
    expect(screen.getByText(/one Study Hall selection can become two half-credit Study Halls/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Find schedules' })
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english'],
      replacementCourseIds: ['course-study-hall'],
    }, true))
  })

  it('allows the same Study Hall course to be selected twice explicitly', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Study', 'Study Hall - NASH')
    await user.click(screen.getByRole('button', { name: 'Add another course' }))
    await pickCatalogCourse(user, screen.getAllByRole('combobox', { name: /Course to add/ })[1], 'Study', 'Study Hall - NASH')

    const submit = screen.getByRole('button', { name: 'Find schedules' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english'],
      replacementCourseIds: ['course-study-hall', 'course-study-hall'],
    }, true))
  })

  it('blocks a replacement set that cannot match a half-credit source course', async () => {
    const halfCreditSource: ScheduleEnrollment = {
      ...english,
      id: 'enrollment-a-day-elective',
      class_id: 'class-a-day-elective',
      meeting_slots: [{ day_type: 'A', period_number: 1 }],
      class: {
        ...english.class,
        id: 'class-a-day-elective',
        course_name_id: 'course-a-day-elective',
        course_name: 'A-Day Elective',
        course_term_policy: 'sectioned_attendance',
        meeting_slots: [{ day_type: 'A', period_number: 1 }],
      },
    }
    const bDayStudyHall: ScheduleEnrollment = {
      ...english,
      id: 'enrollment-b-day-study',
      class_id: 'class-b-day-study',
      meeting_slots: [{ day_type: 'B', period_number: 1 }],
      class: {
        ...english.class,
        id: 'class-b-day-study',
        course_name_id: 'course-b-day-study',
        course_name: 'Study Hall - Current',
        course_term_policy: 'flexible_attendance',
        meeting_slots: [{ day_type: 'B', period_number: 1 }],
      },
    }
    const rest = [chemistry, biology, ...fillerEnrollments]
    mocks.useSchedule.mockReturnValue({ enrollments: [halfCreditSource, bDayStudyHall, ...rest], loading: false, error: null, reload: mocks.reloadSchedule })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /A-Day Elective/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')

    expect(screen.getByText('Credits don’t match')).toBeInTheDocument()
    expect(screen.getByText(/You’re dropping 0\.5 credits, but your additions can only count for 1\.0 or 1\.5 credits/, { selector: '.engine-check-detail p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find schedules' })).toBeDisabled()
  })

  it('keeps the catalog result mounted through a mobile pointer selection', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    const input = screen.getByRole('combobox', { name: 'Course to add' })
    await user.type(input, 'Lit')
    const result = screen.getByRole('option', { name: 'AP Literature' })
    fireEvent.pointerDown(result)
    fireEvent.click(result)
    expect(input).toHaveValue('AP Literature')
    expect(screen.getByText(/Selected:/)).toHaveTextContent('AP Literature')
  })

  it('reminds the student to pick a result when they only typed a course name', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.type(screen.getByRole('combobox', { name: 'Course to add' }), 'Literature')
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    expect(screen.getByText('Choose a course from the search results to use it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find schedules' })).toBeDisabled()
  })

  it('shows a server error next to the submit button', async () => {
    mocks.createScheduleEngineJob.mockRejectedValue(new Error('You already have five active requests. Cancel a queued request or wait for one to finish.'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    await user.click(screen.getByRole('button', { name: 'Find schedules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have five active requests.')
  })

  it('picks a catalog result with the arrow keys and Enter without leaving the search box', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    const input = screen.getByRole('combobox', { name: 'Course to add' })
    await user.type(input, 'AP')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    // Results are not tab stops; the arrow keys move through them instead.
    expect(screen.getByRole('option', { name: 'AP Literature' })).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'AP Literature' }).id)
    expect(screen.getByRole('option', { name: 'AP Literature' })).toHaveClass('is-active')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Study Hall - NASH' }).id)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'AP US History' }).id)

    await user.keyboard('{Enter}')
    expect(input).toHaveValue('AP US History')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByText(/Selected:/)).toHaveTextContent('AP US History')
    // Enter picked the result; it did not submit the form.
    expect(mocks.createScheduleEngineJob).not.toHaveBeenCalled()

    // Down arrow reopens the list after a pick.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox', { name: 'Catalog courses' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('returns focus to the search box when a focused result is picked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    const input = screen.getByRole('combobox', { name: 'Course to add' })
    await user.type(input, 'Lit')
    // Screen readers in browse mode can focus and activate the option itself.
    const option = screen.getByRole('option', { name: 'AP Literature' })
    act(() => option.focus())
    fireEvent.click(option)
    expect(input).toHaveValue('AP Literature')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('announces whether the credits can match as the student picks courses', async () => {
    const halfCreditSource: ScheduleEnrollment = {
      ...english,
      id: 'enrollment-a-day-elective',
      meeting_slots: [{ day_type: 'A', period_number: 1 }],
      class: { ...english.class, id: 'class-a-day-elective', course_name_id: 'course-a-day-elective', course_name: 'A-Day Elective', course_term_policy: 'sectioned_attendance', meeting_slots: [{ day_type: 'A', period_number: 1 }] },
    }
    const bDayStudyHall: ScheduleEnrollment = {
      ...english,
      id: 'enrollment-b-day-study',
      meeting_slots: [{ day_type: 'B', period_number: 1 }],
      class: { ...english.class, id: 'class-b-day-study', course_name_id: 'course-b-day-study', course_name: 'Study Hall - Current', course_term_policy: 'flexible_attendance', meeting_slots: [{ day_type: 'B', period_number: 1 }] },
    }
    mocks.useSchedule.mockReturnValue({ enrollments: [halfCreditSource, bDayStudyHall, chemistry, biology, ...fillerEnrollments], loading: false, error: null, reload: mocks.reloadSchedule })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Courses to drop' })
    const liveRegion = within(screen.getByRole('complementary', { name: 'Before you search' })).getByRole('status')
    expect(liveRegion).toHaveTextContent('')

    await user.click(screen.getByRole('checkbox', { name: /A-Day Elective/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    expect(liveRegion).toHaveTextContent('Credits don’t match. You’re dropping 0.5 credits, but your additions can only count for 1.0 or 1.5 credits.')

    await user.click(screen.getByRole('button', { name: 'Add another course' }))
    await user.click(screen.getByRole('button', { name: 'Remove AP Literature' }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Study', 'Study Hall - NASH')
    expect(liveRegion).toHaveTextContent('Credits can match.')
  })

  it('moves focus to the new request once it is sent', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValueOnce([completedJob()])
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-1', createdAt: '2026-08-02T12:00:00Z' }), completedJob()])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New request/ }))
    await user.click(screen.getByRole('checkbox', { name: /AP English Language/ }))
    await pickCatalogCourse(user, screen.getByRole('combobox', { name: 'Course to add' }), 'Lit', 'AP Literature')
    await user.click(screen.getByRole('button', { name: 'Find schedules' }))

    expect(await screen.findByRole('heading', { name: 'Your request is in line' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Swap AP English Language for AP Literature' })).toHaveFocus())
  })
})

describe('ScheduleEnginePage results', () => {
  it('shows a readable most-likely prediction and can make it the current schedule', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    const user = userEvent.setup()
    renderPage()

    const firstOption = await screen.findByRole('radio', { name: 'Option 1, most likely' })
    expect(firstOption).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Swap AP English Language for AP Literature' })).toBeInTheDocument()
    expect(screen.getByText('No unrelated courses moved')).toBeInTheDocument()
    expect(screen.getByText('Your requested courses fit without moving any unrelated courses.')).toBeInTheDocument()
    // The diff against the current schedule names the changed period.
    const changes = screen.getByRole('heading', { name: 'What changes' }).closest('section')!
    expect(within(changes).getByText('Replaces AP English Language (Carter)')).toBeInTheDocument()
    expect(within(changes).getByText('Period 1, A and B days')).toBeInTheDocument()
    expect(screen.getAllByText('Changed')).not.toHaveLength(0)
    expect(screen.getByRole('radiogroup', { name: 'Day shown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New request/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Make this my schedule' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Make option 1 your schedule?' })
    expect(dialog).toHaveAccessibleDescription('Your current schedule will be replaced with this option.')
    await user.click(within(dialog).getByRole('button', { name: 'Replace my schedule' }))
    await waitFor(() => expect(mocks.applyScheduleEnginePrediction).toHaveBeenCalledWith('job-complete', 1))
    expect(mocks.reloadSchedule).toHaveBeenCalled()
    expect(await screen.findByText(/This option is now your schedule\./)).toBeInTheDocument()
    expect(screen.getByText('Your schedule now matches option 1.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make this my schedule' })).not.toBeInTheDocument()
  })

  it('does not apply when the student keeps their schedule', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Make this my schedule' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep my schedule' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make this my schedule' })).toHaveFocus()
    expect(mocks.applyScheduleEnginePrediction).not.toHaveBeenCalled()
  })

  it('switches between ranked options and shows which periods each one changes', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    const user = userEvent.setup()
    renderPage()
    const secondOption = await screen.findByRole('radio', { name: 'Option 2' })
    expect(secondOption).toHaveAccessibleDescription(/Periods 1 and 3 change/)
    await user.click(secondOption)
    expect(secondOption).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Option 2' })).toBeInTheDocument()
    const changes = screen.getByRole('heading', { name: 'What changes' }).closest('section')!
    expect(within(changes).getByText('Replaces AP English Language (Carter)')).toBeInTheDocument()
    expect(within(changes).getByText('Replaces Biology (Nguyen)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Make this my schedule' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Make option 2 your schedule?' })).getByRole('button', { name: 'Replace my schedule' }))
    await waitFor(() => expect(mocks.applyScheduleEnginePrediction).toHaveBeenCalledWith('job-complete', 2))
  })

  it('shows an apply error next to the apply button', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    mocks.applyScheduleEnginePrediction.mockRejectedValue(new Error('Your schedule changed after this prediction was created. Submit a new request for an up-to-date result.'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Make this my schedule' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace my schedule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your schedule changed after this prediction was created.')
    expect(screen.getByRole('button', { name: 'Make this my schedule' })).toBeEnabled()
  })

  it('keeps focus on the option while applying and moves it to the result afterward', async () => {
    let finishApply!: (value: number) => void
    mocks.applyScheduleEnginePrediction.mockImplementation(() => new Promise<number>((resolve) => { finishApply = resolve }))
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Make this my schedule' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace my schedule' }))

    // The apply button is disabled while saving, so focus waits on the option.
    expect(screen.getByRole('button', { name: 'Updating your schedule…' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Option 1' })).toHaveFocus()

    await act(async () => { finishApply(3) })
    const success = (await screen.findByText(/This option is now your schedule\./)).closest<HTMLElement>('.notice')!
    await waitFor(() => expect(success).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('stops the other options of an applied request from being applied and compares them with the new schedule', async () => {
    const job = completedJob()
    mocks.listScheduleEngineJobs.mockResolvedValue([job])
    // After the apply, the live schedule is option 1.
    mocks.reloadSchedule.mockImplementation(async () => {
      mocks.useSchedule.mockReturnValue({ enrollments: job.predictions[0].schedule, loading: false, error: null, reload: mocks.reloadSchedule })
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Make this my schedule' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace my schedule' }))
    expect(await screen.findByText(/This option is now your schedule\./)).toBeInTheDocument()
    // The applied option still shows what it changed from the old schedule.
    expect(within(screen.getByRole('heading', { name: 'What changed' }).closest('section')!).getByText('Replaces AP English Language (Carter)')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Option 2' }))
    expect(screen.queryByRole('button', { name: 'Make this my schedule' })).not.toBeInTheDocument()
    expect(screen.getByText(/Option 1 is now your schedule, so this option can’t be applied/)).toBeInTheDocument()
    const changes = screen.getByRole('heading', { name: 'What changes' }).closest('section')!
    expect(within(changes).getByText('Replaces AP Literature (Brooks)')).toBeInTheDocument()
    expect(within(changes).queryByText('Replaces AP English Language (Carter)')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Option 2' })).toHaveAccessibleDescription(/Periods 1 and 3 change/)

    await user.click(screen.getByRole('button', { name: 'Start a new request' }))
    expect(screen.getByRole('heading', { name: 'Courses to drop' })).toHaveFocus()
  })

  it('does not let a development placeholder be applied', async () => {
    const job = completedJob()
    job.predictions = [{ ...job.predictions[0], developmentPlaceholder: true }]
    mocks.listScheduleEngineJobs.mockResolvedValue([job])
    renderPage()
    expect(await screen.findByRole('button', { name: 'Make this my schedule' })).toBeDisabled()
    expect(screen.getByText(/development placeholder, so it can’t be applied/)).toBeInTheDocument()
  })

  it('shows the worker explanation when existing sections cannot make a valid schedule', async () => {
    const completedWithoutResult = baseJob({
      id: 'job-no-solution', status: 'completed', emailNotification: false, notificationStatus: 'not_requested',
      processingStartedAt: '2026-08-01T12:10:00Z', completedAt: '2026-08-01T12:11:00Z',
      noValidScheduleReason: 'Biology requires A4, but English has no other legal existing section.',
      replacementCourses: [{ position: 1, courseId: 'course-biology', courseName: 'Biology' }],
    })
    mocks.listScheduleEngineJobs.mockResolvedValue([completedWithoutResult])
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText(completedWithoutResult.noValidScheduleReason!)).toBeInTheDocument()
    expect(screen.getByText('No valid schedule yet')).toBeInTheDocument()
    expect(screen.getByText(/ask your friends to add their schedules/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try a different swap' }))
    expect(screen.getByRole('heading', { name: 'Courses to drop' })).toBeInTheDocument()
  })
})

describe('ScheduleEnginePage request status', () => {
  it('shows queued request details and lets the owner cancel', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-queued' })])
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Your request is in line' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Swap AP English Language for AP Literature' })).toBeInTheDocument()
    expect(screen.getByText(/We’ll email you when your options are ready/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel this request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(mocks.cancelScheduleEngineJob).toHaveBeenCalledWith('job-queued'))
    expect(await screen.findByText('Request cancelled.')).toBeInTheDocument()
  })

  it('keeps focus on the request while and after it is cancelled', async () => {
    let finishCancel!: () => void
    mocks.cancelScheduleEngineJob.mockImplementation(() => new Promise<void>((resolve) => { finishCancel = resolve }))
    mocks.listScheduleEngineJobs.mockResolvedValueOnce([baseJob({ id: 'job-queued' })])
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-queued', status: 'cancelled' })])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel request' }))
    const title = screen.getByRole('heading', { name: 'Swap AP English Language for AP Literature' })
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
    expect(title).toHaveFocus()

    await act(async () => { finishCancel() })
    expect(await screen.findByText('You cancelled this request before it ran.')).toBeInTheDocument()
    expect(title).toHaveFocus()
  })

  it('keeps a queued request when the student backs out of cancelling', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-queued' })])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep request' }))
    expect(mocks.cancelScheduleEngineJob).not.toHaveBeenCalled()
  })

  it('shows a processing request without a cancel button', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-processing', status: 'processing', processingStartedAt: '2026-08-01T12:05:00Z', emailNotification: false })])
    renderPage()
    expect(await screen.findByRole('heading', { name: 'The engine is working on your request' })).toBeInTheDocument()
    expect(screen.getByText(/check back later/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument()
  })

  it('checks for updates while a request is waiting and says when results arrive', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-complete' })])
    renderPage()
    await screen.findByRole('heading', { name: 'Your request is in line' })
    expect(mocks.listScheduleEngineJobs).toHaveBeenCalledTimes(1)
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(mocks.listScheduleEngineJobs).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Your Schedule Engine results are ready.')).toBeInTheDocument()
  })

  it('explains failed and cancelled requests', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([
      baseJob({ id: 'job-failed', status: 'failed', errorMessage: 'The worker stopped early.' }),
      baseJob({ id: 'job-cancelled', status: 'cancelled', createdAt: '2026-07-30T12:00:00Z' }),
    ])
    const user = userEvent.setup()
    renderPage()
    const alert = await screen.findByRole('alert')
    // The worker's message stands on its own, followed by what to do next.
    expect(within(alert).getByText('The worker stopped early.')).toBeInTheDocument()
    expect(within(alert).getByText('Start a new request to try again.')).toBeInTheDocument()

    const history = screen.getByRole('heading', { name: 'Your requests' }).closest('section')!
    const rows = within(history).getAllByRole('button')
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    await user.click(rows[1])
    expect(screen.getByText('You cancelled this request before it ran.')).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
  })

  it('turns the worker’s generic failure into student-facing copy', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({
      id: 'job-failed', status: 'failed',
      errorMessage: 'Schedule Engine processing failed. The request can be tried again after the worker is checked.',
    })])
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This request didn’t finish.')
    expect(within(alert).getByText('Something went wrong while the engine was searching.')).toBeInTheDocument()
    expect(within(alert).getByText('Start a new request to try again.')).toBeInTheDocument()
    expect(alert).not.toHaveTextContent(/worker is checked/)
  })

  it('does not repeat guidance the failure message already gives', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-failed', status: 'failed', errorMessage: 'Your classes changed while it ran. Try again with a new request' })])
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Your classes changed while it ran. Try again with a new request')).toBeInTheDocument()
    expect(within(alert).queryByText('Start a new request to try again.')).not.toBeInTheDocument()
  })

  it('scrolls to and focuses a past request picked from the list', async () => {
    const scrolled: Element[] = []
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this) }
    try {
      mocks.listScheduleEngineJobs.mockResolvedValue([
        completedJob(),
        baseJob({ id: 'job-failed', status: 'failed', createdAt: '2026-07-30T12:00:00Z', replacementCourses: [{ position: 1, courseId: 'course-history', courseName: 'AP US History' }] }),
      ])
      const user = userEvent.setup()
      renderPage()
      const history = (await screen.findByRole('heading', { name: 'Your requests' })).closest('section')!
      await user.click(within(history).getByRole('button', { name: /Swap AP English Language for AP US History/ }))

      const title = screen.getByRole('heading', { name: 'Swap AP English Language for AP US History' })
      await waitFor(() => expect(title).toHaveFocus())
      expect(title).toHaveAccessibleDescription(/Failed/)
      expect(scrolled).toContain(title.closest('section'))
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('stops new requests at the active request limit', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue(Array.from({ length: 5 }, (_, index) => baseJob({ id: `job-${index}` })))
    renderPage()
    expect(await screen.findByText(/You have five requests in progress/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New request/ })).toBeDisabled()
  })

  it('opens a new request from a past one and can go back, keeping focus on what replaced the button', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([completedJob()])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New request/ }))
    // The header button goes away with the form open, so focus moves to the form.
    expect(screen.getByRole('heading', { name: 'Courses to drop' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('radio', { name: 'Option 1, most likely' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Swap AP English Language for AP Literature' })).toHaveFocus()
  })

  it('moves focus to the schedule check when a new request needs a complete schedule first', async () => {
    mocks.listScheduleEngineJobs.mockResolvedValue([baseJob({ id: 'job-cancelled', status: 'cancelled' })])
    mocks.useSchedule.mockReturnValue({ enrollments: [english, chemistry], loading: false, error: null, reload: mocks.reloadSchedule })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Start a new request' }))
    expect(screen.getByRole('heading', { name: 'Fill every period first' })).toHaveFocus()
  })
})

describe('ScheduleEnginePage styles', () => {
  it('lays out from the page width and keeps long catalog results inside their own scroller', () => {
    expect(getCssDeclarations(engineStyles, '.engine-page')).toMatchObject({ container: 'engine-page / inline-size' })
    expect(getCssDeclarations(engineStyles, '.engine-picker-results')).toMatchObject({
      position: 'absolute',
      'max-height': 'min(320px, 50dvh)',
      'overflow-y': 'auto',
    })
  })

  it('marks changed periods with the same gold wash the schedule grid uses for changed classes', () => {
    expect(getCssDeclarations(engineStyles, '.engine-option-numerals .period-numeral, .engine-change .period-numeral')).toMatchObject({
      background: 'var(--gold-wash-strong)',
      color: 'var(--ink)',
    })
  })
})
