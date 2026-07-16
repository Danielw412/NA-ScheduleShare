import { describe, expect, it } from 'vitest'
import type { MeetingSlot, ScheduleEnrollment } from './domain'
import { defaultMeetingSlots, findScheduleConflicts, hasMultiplePeriodsOnAnyDay, termIncludes, termsOverlap, validateMeetingSlots } from './schedule'

function enrollment(id: string, term: ScheduleEnrollment['academic_term'], meetingSlots: MeetingSlot[]): ScheduleEnrollment {
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
      course_name_id: `course-${id}`,
      course_name: `Course ${id}`,
      teacher_last_name: 'Teacher',
      default_academic_term: term,
      is_double_period: hasMultiplePeriodsOnAnyDay(meetingSlots),
      meeting_slots: meetingSlots,
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
  it('finds any shared explicit slot when terms overlap', () => {
    const flexible = enrollment('a', 'full_year', [
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ])
    const overlapping = enrollment('b', 'semester_2', [{ day_type: 'B', period_number: 3 }])
    expect(findScheduleConflicts([flexible, overlapping])).toHaveLength(1)
  })

  it('does not conflict when only the period matches on different days', () => {
    expect(findScheduleConflicts([
      enrollment('a', 'full_year', [{ day_type: 'A', period_number: 2 }]),
      enrollment('b', 'full_year', [{ day_type: 'B', period_number: 2 }]),
    ])).toHaveLength(0)
  })

  it('allows opposite-semester classes in the same slot', () => {
    expect(findScheduleConflicts([
      enrollment('a', 'semester_1', [{ day_type: 'A', period_number: 2 }]),
      enrollment('b', 'semester_2', [{ day_type: 'A', period_number: 2 }]),
    ])).toHaveLength(0)
  })
})

describe('explicit meeting-slot selections', () => {
  it('defaults a normal class to the clicked period on both days', () => {
    expect(defaultMeetingSlots('B', 4)).toEqual([
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 4 },
    ])
  })

  it.each([
    ['one period on both days', [
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 4 },
    ]],
    ['two periods on both days', [
      { day_type: 'A', period_number: 3 },
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ]],
    ['different periods on A and B days', [
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ]],
    ['an A-day-only class', [{ day_type: 'A', period_number: 6 }]],
    ['a B-day-only class', [{ day_type: 'B', period_number: 7 }]],
    ['nonconsecutive periods', [
      { day_type: 'A', period_number: 2 },
      { day_type: 'A', period_number: 5 },
    ]],
  ] satisfies Array<[string, MeetingSlot[]]>)('accepts %s', (_label, meetingSlots) => {
    expect(validateMeetingSlots(meetingSlots)).toBeNull()
  })

  it('requires at least one unique, valid slot', () => {
    expect(validateMeetingSlots([])).toBe('Select at least one meeting slot.')
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 2 },
      { day_type: 'A', period_number: 2 },
    ])).toBe('Meeting slots cannot be duplicated.')
    expect(validateMeetingSlots([{ day_type: 'B', period_number: 10 }])).toContain('1 through 9')
  })

  it('derives legacy multiple-period metadata from either day independently', () => {
    expect(hasMultiplePeriodsOnAnyDay([
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ])).toBe(true)
    expect(hasMultiplePeriodsOnAnyDay(defaultMeetingSlots('A', 4))).toBe(false)
  })
})
