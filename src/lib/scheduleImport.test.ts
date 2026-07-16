import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableScheduleImportRow } from './scheduleImport'

const mocks = vi.hoisted(() => ({
  createClassAndEnroll: vi.fn(),
  enrollInClass: vi.fn(),
  searchClasses: vi.fn(),
}))

vi.mock('./supabase/data', () => mocks)

import { confirmScheduleImport } from './scheduleImport'

const row: EditableScheduleImportRow = {
  id: 'import-1',
  source_course_name: 'AP Statistics (CHS)',
  course: { id: '11111111-1111-4111-8111-111111111111', name: 'AP Statistics', confidence: 0.98 },
  teacher_last_name: 'Lester',
  term: 'full_year',
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  confidence: 0.97,
  warnings: [],
  flags: [],
  resolution: 'new_class',
  existing_class_id: null,
  selected_existing_class_id: null,
  class_options: [],
  include: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchClasses.mockResolvedValue([])
  mocks.createClassAndEnroll.mockResolvedValue('enrollment-new')
  mocks.enrollInClass.mockResolvedValue('enrollment-existing')
})

describe('confirmScheduleImport', () => {
  it('creates a class only for the selected existing course ID and never sends a new course name', async () => {
    await confirmScheduleImport([row])
    expect(mocks.createClassAndEnroll).toHaveBeenCalledWith({
      courseNameId: row.course?.id,
      teacherLastName: 'Lester',
      term: 'full_year',
      isDoublePeriod: false,
      meetingSlots: row.meeting_slots,
      confirmedNoCourseMatch: false,
    })
    expect(mocks.createClassAndEnroll.mock.calls[0][0]).not.toHaveProperty('newCourseName')
  })

  it('rechecks for an existing exact class immediately before saving and enrolls instead of creating', async () => {
    mocks.searchClasses.mockResolvedValue([{
      id: 'class-existing',
      course_name_id: row.course?.id,
      course_name: row.course?.name,
      teacher_last_name: 'Lester',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: row.meeting_slots,
      score: 100,
    }])
    await confirmScheduleImport([row])
    expect(mocks.enrollInClass).toHaveBeenCalledWith('class-existing', 'full_year')
    expect(mocks.createClassAndEnroll).not.toHaveBeenCalled()
  })

  it('always creates Lunch and Study Hall classes with teacher N/A', async () => {
    await confirmScheduleImport([{
      ...row,
      course: { id: '22222222-2222-4222-8222-222222222222', name: 'Lunch', confidence: 1 },
      teacher_last_name: 'Staff',
    }])
    expect(mocks.createClassAndEnroll).toHaveBeenCalledWith(expect.objectContaining({ teacherLastName: 'N/A' }))
  })
})
