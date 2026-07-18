import { describe, expect, it } from 'vitest'
import type { MeetingSlot, ScheduleEnrollment } from './domain'
import { buildNormalMeetingSlots, compactMeetingSlotLabels, defaultDoubleMeetingSlots, defaultMeetingSlots, findScheduleConflicts, hasMultiplePeriodsOnAnyDay, meetingDaySelectionFromSlots, meetingPeriodFromSlots, termIncludes, termsOverlap, validateMeetingSlots } from './schedule'

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
    expect(buildNormalMeetingSlots('both', 4)).toEqual(defaultMeetingSlots('B', 4))
  })

  it('supports A-day-only and B-day-only normal classes', () => {
    expect(buildNormalMeetingSlots('A', 6)).toEqual([{ day_type: 'A', period_number: 6 }])
    expect(buildNormalMeetingSlots('B', 7)).toEqual([{ day_type: 'B', period_number: 7 }])
    expect(validateMeetingSlots(buildNormalMeetingSlots('A', 6), false)).toBeNull()
    expect(validateMeetingSlots(buildNormalMeetingSlots('B', 7), false)).toBeNull()
  })

  it('preselects a clicked day plus a continuation for a double-period class', () => {
    expect(defaultDoubleMeetingSlots('A', 4)).toEqual([
      { day_type: 'A', period_number: 4 },
      { day_type: 'A', period_number: 5 },
      { day_type: 'B', period_number: 4 },
    ])
    expect(defaultDoubleMeetingSlots('B', 9)).toEqual([
      { day_type: 'A', period_number: 9 },
      { day_type: 'B', period_number: 8 },
      { day_type: 'B', period_number: 9 },
    ])
  })

  it.each([
    ['one period on both days', [
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 4 },
    ]],
    ['an A-day-only class', [{ day_type: 'A', period_number: 6 }]],
    ['a B-day-only class', [{ day_type: 'B', period_number: 7 }]],
  ] satisfies Array<[string, MeetingSlot[]]>)('accepts %s', (_label, meetingSlots) => {
    expect(validateMeetingSlots(meetingSlots, false)).toBeNull()
  })

  it('accepts independent slots for a valid double-period class', () => {
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ], true)).toBeNull()
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 3 },
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ], true)).toBeNull()
  })

  it('rejects double-period selections that are not consecutive or have no double day', () => {
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 2 },
      { day_type: 'A', period_number: 5 },
    ], true)).toContain('consecutive')
    expect(validateMeetingSlots(defaultMeetingSlots('A', 4), true)).toContain('two consecutive')
    expect(validateMeetingSlots([
      { day_type: 'A', period_number: 4 },
      { day_type: 'A', period_number: 5 },
    ], false)).toContain('normal class')
  })

  it('recovers the normal selector state from explicit slots', () => {
    expect(meetingDaySelectionFromSlots([{ day_type: 'A', period_number: 4 }, { day_type: 'B', period_number: 4 }])).toBe('both')
    expect(meetingDaySelectionFromSlots([{ day_type: 'A', period_number: 4 }])).toBe('A')
    expect(meetingDaySelectionFromSlots([{ day_type: 'B', period_number: 4 }])).toBe('B')
    expect(meetingPeriodFromSlots([{ day_type: 'B', period_number: 4 }, { day_type: 'A', period_number: 3 }])).toBe(3)
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

  it('groups matching A/B periods while preserving single-day periods', () => {
    expect(compactMeetingSlotLabels([
      { day_type: 'A', period_number: 5 },
      { day_type: 'B', period_number: 5 },
    ])).toEqual(['P5'])
    expect(compactMeetingSlotLabels([{ day_type: 'B', period_number: 5 }])).toEqual(['B P5'])
    expect(compactMeetingSlotLabels([
      { day_type: 'A', period_number: 1 },
      { day_type: 'A', period_number: 2 },
      { day_type: 'B', period_number: 1 },
    ])).toEqual(['P1', 'A P2'])
  })
})
