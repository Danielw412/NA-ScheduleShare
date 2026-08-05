import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEngineJob, ScheduleEnrollment } from '../lib/domain'
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

function renderPage() {
  return render(<MemoryRouter><ScheduleEnginePage /></MemoryRouter>)
}

beforeEach(() => {
  mocks.useSchedule.mockReturnValue({ enrollments: [english, chemistry, biology], loading: false, error: null, reload: mocks.reloadSchedule })
  mocks.useCourseNameSearch.mockReturnValue({
    loading: false,
    error: null,
    results: [
      { id: 'course-english', course_name: 'AP English Language', course_term_policy: 'full_year', score: 100 },
      { id: 'course-literature', course_name: 'AP Literature', course_term_policy: 'full_year', score: 95 },
      { id: 'course-history', course_name: 'AP US History', course_term_policy: 'full_year', score: 90 },
      { id: 'course-economics', course_name: 'AP Economics', course_term_policy: 'full_year', score: 85 },
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
})

describe('ScheduleEnginePage', () => {
  it('submits catalog and enrollment IDs only after a valid replacement is complete', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Course replacements' })).toBeInTheDocument())

    const submit = screen.getByRole('button', { name: 'Submit request' })
    expect(submit).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Current course'), english.id)
    await user.type(screen.getByRole('combobox', { name: 'Replacement course' }), 'AP Lit')

    expect(screen.queryByRole('option', { name: 'AP English Language' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'AP Literature' }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english'],
      replacementCourseIds: ['course-literature'],
    }, true))
  })

  it('supports three independent current courses and three independent replacement courses', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add another current course' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Current course'), english.id)
    await user.click(screen.getByRole('button', { name: 'Add another current course' }))
    const courseSelects = screen.getAllByLabelText(/Current course/)
    expect(within(courseSelects[1]).queryByRole('option', { name: /AP English Language/ })).not.toBeInTheDocument()
    await user.selectOptions(courseSelects[1], chemistry.id)
    await user.click(screen.getByRole('button', { name: 'Add another current course' }))
    const allCourseSelects = screen.getAllByLabelText(/Current course/)
    await user.selectOptions(allCourseSelects[2], biology.id)

    await user.type(screen.getByRole('combobox', { name: 'Replacement course' }), 'Lit')
    await user.click(screen.getByRole('option', { name: 'AP Literature' }))
    await user.click(screen.getByRole('button', { name: 'Add another replacement course' }))
    const replacementInputs = screen.getAllByRole('combobox', { name: 'Replacement course' })
    await user.type(replacementInputs[1], 'History')
    const secondTarget = replacementInputs[1].closest<HTMLElement>('.engine-selection-row')!
    expect(within(secondTarget).queryByRole('option', { name: 'AP Literature' })).not.toBeInTheDocument()
    await user.click(within(secondTarget).getByRole('option', { name: 'AP US History' }))
    await user.click(screen.getByRole('button', { name: 'Add another replacement course' }))
    const thirdReplacement = screen.getAllByRole('combobox', { name: 'Replacement course' })[2]
    await user.type(thirdReplacement, 'Economics')
    const thirdTarget = thirdReplacement.closest<HTMLElement>('.engine-selection-row')!
    await user.click(within(thirdTarget).getByRole('option', { name: 'AP Economics' }))
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith({
      enrollmentIds: ['enrollment-english', 'enrollment-chemistry', 'enrollment-biology'],
      replacementCourseIds: ['course-literature', 'course-history', 'course-economics'],
    }, true))
  })

  it('keeps the catalog result mounted through a mobile pointer selection', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Course replacements' })
    await user.selectOptions(screen.getByLabelText('Current course'), english.id)
    const input = screen.getByRole('combobox', { name: 'Replacement course' })
    await user.type(input, 'Lit')
    const result = screen.getByRole('option', { name: 'AP Literature' })
    fireEvent.pointerDown(result)
    fireEvent.click(result)
    expect(input).toHaveValue('AP Literature')
    expect(screen.getByText(/Selected catalog course:/)).toHaveTextContent('AP Literature')
  })

  it('shows a readable most-likely prediction and can make it the current schedule', async () => {
    const completed: ScheduleEngineJob = {
      id: 'job-complete',
      status: 'completed',
      emailNotification: true,
      notificationStatus: 'pending',
      queuedAt: '2026-08-01T12:00:00Z',
      processingStartedAt: '2026-08-01T12:10:00Z',
      completedAt: '2026-08-01T12:20:00Z',
      failedAt: null,
      cancelledAt: null,
      errorMessage: null,
      noValidScheduleReason: null,
      createdAt: '2026-08-01T12:00:00Z',
      updatedAt: '2026-08-01T12:20:00Z',
      sourceCourses: [{ position: 1, enrollmentId: english.id, courseId: 'course-english', courseName: 'AP English Language' }],
      replacementCourses: [{ position: 1, courseId: 'course-literature', courseName: 'AP Literature' }],
      predictions: [{
        rank: 1,
        developmentPlaceholder: false,
        collateralChangeCount: 0,
        searchStage: 'direct_replacement',
        explanations: ['Requested change: dropped AP English Language and added AP Literature using an existing section.'],
        schedule: [{
          ...english,
          id: 'prediction-literature',
          class_id: 'class-literature',
          changedFromEnrollmentId: english.id,
          class: { ...english.class, id: 'class-literature', course_name_id: 'course-literature', course_name: 'AP Literature' },
        }, { ...chemistry, changedFromEnrollmentId: null }],
      }],
    }
    mocks.listScheduleEngineJobs.mockResolvedValue([completed])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText(/Selected result:/)).toHaveTextContent('Most likely')
    expect(screen.getByText('No unrelated courses moved')).toBeInTheDocument()
    expect(screen.getByText('Your requested courses fit without moving any unrelated courses.')).toBeInTheDocument()
    expect(screen.getAllByText('Changed')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /New request/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Make this my schedule' }))
    await waitFor(() => expect(mocks.applyScheduleEnginePrediction).toHaveBeenCalledWith('job-complete', 1))
    expect(mocks.reloadSchedule).toHaveBeenCalled()
    expect(await screen.findByText('This prediction is now your schedule.')).toBeInTheDocument()
  })

  it('shows queued request details and lets the owner cancel', async () => {
    const queued: ScheduleEngineJob = { id: 'job-queued', status: 'queued', emailNotification: true, notificationStatus: 'pending', queuedAt: '2026-08-01T12:00:00Z', processingStartedAt: null, completedAt: null, failedAt: null, cancelledAt: null, errorMessage: null, noValidScheduleReason: null, createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:00:00Z', sourceCourses: [{ position: 1, enrollmentId: english.id, courseId: 'course-english', courseName: 'AP English Language' }], replacementCourses: [{ position: 1, courseId: 'course-literature', courseName: 'AP Literature' }], predictions: [] }
    mocks.listScheduleEngineJobs.mockResolvedValue([queued])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Your requested changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(mocks.cancelScheduleEngineJob).toHaveBeenCalledWith('job-queued'))
  })

  it('shows the worker explanation when existing sections cannot make a valid schedule', async () => {
    const completedWithoutResult: ScheduleEngineJob = {
      id: 'job-no-solution', status: 'completed', emailNotification: false, notificationStatus: 'not_requested',
      queuedAt: '2026-08-01T12:00:00Z', processingStartedAt: '2026-08-01T12:10:00Z', completedAt: '2026-08-01T12:11:00Z',
      failedAt: null, cancelledAt: null, errorMessage: null,
      noValidScheduleReason: 'Biology requires A4, but English has no other legal existing section.',
      createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:11:00Z',
      sourceCourses: [{ position: 1, enrollmentId: english.id, courseId: 'course-english', courseName: 'AP English Language' }],
      replacementCourses: [{ position: 1, courseId: 'course-biology', courseName: 'Biology' }], predictions: [],
    }
    mocks.listScheduleEngineJobs.mockResolvedValue([completedWithoutResult])
    renderPage()
    expect(await screen.findByText(completedWithoutResult.noValidScheduleReason!)).toBeInTheDocument()
    expect(screen.getByText('No valid schedule yet')).toBeInTheDocument()
    expect(screen.getByText(/ask your friends to add their schedules/i)).toBeInTheDocument()
  })
})
