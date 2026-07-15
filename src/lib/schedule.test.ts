import { describe, expect, it } from 'vitest'
import type { ScheduleEnrollment } from './domain'
import { buildMeetingSlots, findScheduleConflicts, suggestedDoubleSlots, termIncludes, termsOverlap, validateMeetingSlots } from './schedule'

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

  it('keeps a period-nine selection in range', () => {
    expect(suggestedDoubleSlots({ day_type: 'A', period_number: 9 })).toEqual([
      { day_type: 'A', period_number: 8 },
      { day_type: 'A', period_number: 9 },
    ])
  })

  it('defaults a normal class to the selected period on both A and B days', () => {
    expect(buildMeetingSlots('both', 9, false)).toEqual([
      { day_type: 'A', period_number: 9 },
      { day_type: 'B', period_number: 9 },
    ])
  })

  it('builds consecutive double-period slots for every selected meeting day', () => {
    expect(buildMeetingSlots('both', 4, true)).toEqual([
      { day_type: 'A', period_number: 4 },
      { day_type: 'A', period_number: 5 },
      { day_type: 'B', period_number: 4 },
      { day_type: 'B', period_number: 5 },
    ])
  })

  it('rejects invalid single and double-period meeting-slot combinations', () => {
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 2 },
      { day_type: 'A', period_number: 3 },
    ], false)).toContain('one A-day period')
    expect(validateMeetingSlots([
      { day_type: 'B', period_number: 2 },
      { day_type: 'B', period_number: 4 },
    ], true)).toContain('two consecutive B-day periods')
  })
})
