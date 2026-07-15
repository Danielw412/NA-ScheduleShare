import { describe, expect, it } from 'vitest'
import type { ScheduleEnrollment } from './domain'
import { findScheduleConflicts, suggestedDoubleSlots, termIncludes, termsOverlap } from './schedule'

function enrollment(id: string, term: ScheduleEnrollment['academic_term'], period: number): ScheduleEnrollment {
  return {
    id,
    student_id: 'student',
    class_id: `class-${id}`,
    academic_term: term,
    active: true,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    class: {
      id: `class-${id}`,
      class_name: `Class ${id}`,
      teacher_name: 'Teacher',
      default_academic_term: term,
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: period }],
    },
  }
}

describe('term matching', () => {
  it('treats full-year classes as overlapping either semester', () => {
    expect(termsOverlap('full_year', 'semester_1')).toBe(true)
    expect(termsOverlap('semester_2', 'full_year')).toBe(true)
    expect(termIncludes('full_year', 'semester_2')).toBe(true)
  })

  it('does not treat opposite semesters as overlapping', () => {
    expect(termsOverlap('semester_1', 'semester_2')).toBe(false)
  })
})

describe('schedule conflicts', () => {
  it('finds same-slot classes whose terms overlap', () => {
    expect(findScheduleConflicts([enrollment('a', 'full_year', 2), enrollment('b', 'semester_2', 2)])).toHaveLength(1)
  })

  it('allows opposite-semester classes in the same slot', () => {
    expect(findScheduleConflicts([enrollment('a', 'semester_1', 2), enrollment('b', 'semester_2', 2)])).toHaveLength(0)
  })
})

describe('double-period suggestions', () => {
  it('suggests the next consecutive period', () => {
    expect(suggestedDoubleSlots({ day_type: 'B', period_number: 4 })).toEqual([
      { day_type: 'B', period_number: 4 },
      { day_type: 'B', period_number: 5 },
    ])
  })

  it('keeps a period-eight selection in range', () => {
    expect(suggestedDoubleSlots({ day_type: 'A', period_number: 8 })).toEqual([
      { day_type: 'A', period_number: 7 },
      { day_type: 'A', period_number: 8 },
    ])
  })
})

