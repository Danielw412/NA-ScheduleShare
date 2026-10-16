import type { DayType, MeetingSlot, ScheduleEnrollment, SemesterTerm } from '../../lib/domain'
import { enrollmentAtSlot, PERIOD_NUMBERS } from '../../lib/schedule'

const SEMESTERS: SemesterTerm[] = ['semester_1', 'semester_2']
const DAYS: DayType[] = ['A', 'B']

/**
 * One visible difference between two schedules: the class that sits in a
 * set of A/B-day periods before and after. Periods where the same class moves
 * in and out together are grouped so a full-year, A-and-B-day swap is one row.
 */
export interface ScheduleChange {
  key: string
  from: ScheduleEnrollment | null
  to: ScheduleEnrollment | null
  slots: MeetingSlot[]
  terms: SemesterTerm[]
}

/** Compares two schedules period by period in both semesters. */
export function scheduleChanges(current: ScheduleEnrollment[], next: ScheduleEnrollment[]): ScheduleChange[] {
  const groups = new Map<string, { from: ScheduleEnrollment | null; to: ScheduleEnrollment | null; slots: Map<string, MeetingSlot>; terms: Set<SemesterTerm> }>()
  for (const term of SEMESTERS) {
    for (const day of DAYS) {
      for (const period of PERIOD_NUMBERS) {
        const before = enrollmentAtSlot(current, day, period, term) ?? null
        const after = enrollmentAtSlot(next, day, period, term) ?? null
        if ((before?.class_id ?? null) === (after?.class_id ?? null)) continue
        const key = `${before?.class_id ?? 'none'}>${after?.class_id ?? 'none'}`
        const group = groups.get(key) ?? { from: before, to: after, slots: new Map(), terms: new Set() }
        group.slots.set(`${day}${period}`, { day_type: day, period_number: period })
        group.terms.add(term)
        groups.set(key, group)
      }
    }
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      from: group.from,
      to: group.to,
      slots: [...group.slots.values()].sort((left, right) => left.period_number - right.period_number || left.day_type.localeCompare(right.day_type)),
      terms: SEMESTERS.filter((term) => group.terms.has(term)),
    }))
    .sort((left, right) => (
      left.slots[0].period_number - right.slots[0].period_number
      || left.slots[0].day_type.localeCompare(right.slots[0].day_type)
      || SEMESTERS.indexOf(left.terms[0]) - SEMESTERS.indexOf(right.terms[0])
    ))
}

/** The distinct period numbers touched by a set of changes, in order. */
export function changedPeriods(changes: ScheduleChange[]): number[] {
  return [...new Set(changes.flatMap((change) => change.slots.map((slot) => slot.period_number)))].sort((left, right) => left - right)
}

/** Enrollment IDs in the new schedule that differ from the current one. */
export function changedEnrollmentIds(changes: ScheduleChange[]): Set<string> {
  return new Set(changes.flatMap((change) => change.to ? [change.to.id] : []))
}
