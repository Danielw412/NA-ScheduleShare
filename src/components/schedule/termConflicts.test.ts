import { describe, expect, it } from 'vitest'
import type { DayType, ScheduleEnrollment } from '../../lib/domain'
import { classCoveringHiddenEnrollment, conflictsInTerm } from './termConflicts'

function enrollment(id: string, term: ScheduleEnrollment['academic_term'], slots: Array<[DayType, number]>): ScheduleEnrollment {
  const meetingSlots = slots.map(([day_type, period_number]) => ({ day_type, period_number }))
  return {
    id,
    class_id: `class-${id}`,
    student_id: 'student',
    academic_term: term,
    active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    meeting_slots: meetingSlots,
    class: { id: `class-${id}`, course_name_id: `course-${id}`, course_name: id, teacher_last_name: 'Teacher', default_academic_term: term, is_double_period: false, meeting_slots: meetingSlots },
  }
}

describe('conflictsInTerm', () => {
  it('keeps only pairs where both classes meet in the semester', () => {
    const fullYear = enrollment('chemistry', 'full_year', [['A', 3], ['B', 3]])
    const springOnly = enrollment('robotics', 'semester_2', [['A', 3], ['B', 3]])
    expect(conflictsInTerm([fullYear, springOnly], 'semester_1')).toEqual([])
    expect(conflictsInTerm([fullYear, springOnly], 'semester_2')).toEqual([[fullYear, springOnly]])
  })
})

describe('classCoveringHiddenEnrollment', () => {
  it('names the class drawn in place of one that has no cell of its own', () => {
    const spanish = enrollment('spanish', 'full_year', [['A', 6], ['B', 6]])
    const writing = enrollment('writing', 'full_year', [['B', 6], ['A', 6]])
    expect(classCoveringHiddenEnrollment([spanish, writing], writing, 'semester_1')).toBe(spanish)
    expect(classCoveringHiddenEnrollment([spanish, writing], spanish, 'semester_1')).toBeNull()
  })

  it('returns null while the class still has at least one cell', () => {
    const spanish = enrollment('spanish', 'full_year', [['A', 6], ['B', 6]])
    const writing = enrollment('writing', 'full_year', [['A', 6], ['B', 7]])
    expect(classCoveringHiddenEnrollment([spanish, writing], writing, 'semester_1')).toBeNull()
  })
})
