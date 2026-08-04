import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEngineJob, ScheduleEnrollment } from '../lib/domain'
import { ScheduleEnginePage } from './ScheduleEnginePage'

const mocks = vi.hoisted(() => ({
  useSchedule: vi.fn(),
  useCourseNameSearch: vi.fn(),
  createScheduleEngineJob: vi.fn(),
  getLatestScheduleEngineJob: vi.fn(),
}))

vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../hooks/useCourseNameSearch', () => ({ useCourseNameSearch: mocks.useCourseNameSearch }))
vi.mock('../lib/supabase/data', () => ({
  createScheduleEngineJob: mocks.createScheduleEngineJob,
  getLatestScheduleEngineJob: mocks.getLatestScheduleEngineJob,
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

function renderPage() {
  return render(<MemoryRouter><ScheduleEnginePage /></MemoryRouter>)
}

beforeEach(() => {
  mocks.useSchedule.mockReturnValue({ enrollments: [english, chemistry], loading: false, error: null })
  mocks.useCourseNameSearch.mockReturnValue({
    loading: false,
    error: null,
    results: [
      { id: 'course-english', course_name: 'AP English Language', course_term_policy: 'full_year', score: 100 },
      { id: 'course-literature', course_name: 'AP Literature', course_term_policy: 'full_year', score: 95 },
      { id: 'course-history', course_name: 'AP US History', course_term_policy: 'full_year', score: 90 },
    ],
  })
  mocks.getLatestScheduleEngineJob.mockResolvedValue(null)
  mocks.createScheduleEngineJob.mockResolvedValue('job-1')
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

    await waitFor(() => expect(mocks.createScheduleEngineJob).toHaveBeenCalledWith([
      { enrollmentId: 'enrollment-english', replacementCourseId: 'course-literature' },
    ], true))
  })

  it('prevents duplicate current courses and duplicate replacement courses across rows', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Add another replacement/ })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Current course'), english.id)
    await user.type(screen.getByRole('combobox', { name: 'Replacement course' }), 'Lit')
    await user.click(screen.getByRole('option', { name: 'AP Literature' }))
    await user.click(screen.getByRole('button', { name: /Add another replacement/ }))

    const courseSelects = screen.getAllByLabelText('Current course')
    expect(within(courseSelects[1]).queryByRole('option', { name: /AP English Language/ })).not.toBeInTheDocument()
    await user.selectOptions(courseSelects[1], chemistry.id)
    const replacementInputs = screen.getAllByRole('combobox', { name: 'Replacement course' })
    await user.type(replacementInputs[1], 'History')
    const secondRow = replacementInputs[1].closest<HTMLElement>('.engine-replacement-row')!
    expect(within(secondRow).queryByRole('option', { name: 'AP Literature' })).not.toBeInTheDocument()
  })

  it('shows completed ranked predictions and marks changed courses', async () => {
    const completed: ScheduleEngineJob = {
      id: 'job-complete',
      status: 'completed',
      emailNotification: true,
      notificationStatus: 'pending',
      queuedAt: '2026-08-01T12:00:00Z',
      processingStartedAt: '2026-08-01T12:10:00Z',
      completedAt: '2026-08-01T12:20:00Z',
      failedAt: null,
      errorMessage: null,
      createdAt: '2026-08-01T12:00:00Z',
      updatedAt: '2026-08-01T12:20:00Z',
      replacements: [{ position: 1, enrollmentId: english.id, currentCourseId: 'course-english', currentCourseName: 'AP English Language', replacementCourseId: 'course-literature', replacementCourseName: 'AP Literature' }],
      predictions: [{
        rank: 1,
        developmentPlaceholder: false,
        schedule: [{
          ...english,
          id: 'prediction-literature',
          class_id: 'class-literature',
          changedFromEnrollmentId: english.id,
          class: { ...english.class, id: 'class-literature', course_name_id: 'course-literature', course_name: 'AP Literature' },
        }, { ...chemistry, changedFromEnrollmentId: null }],
      }],
    }
    mocks.getLatestScheduleEngineJob.mockResolvedValue(completed)
    renderPage()

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Most likely' })).toBeInTheDocument()
    expect(screen.getAllByText('Changed')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /Create another request/ })).toBeInTheDocument()
  })
})
