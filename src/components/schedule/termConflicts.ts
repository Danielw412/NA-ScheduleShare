import type { ScheduleEnrollment, SemesterTerm } from '../../lib/domain'
import { enrollmentAtSlot, enrollmentMeetingSlots, findScheduleConflicts, sortMeetingSlots, termIncludes } from '../../lib/schedule'

/**
 * Conflicting pairs where both classes meet in the semester on screen. A
 * full-year class only clashes with a Semester 2 class in Semester 2, so the
 * Semester 1 view must not flag it.
 */
export function conflictsInTerm(enrollments: ScheduleEnrollment[], term: SemesterTerm): Array<[ScheduleEnrollment, ScheduleEnrollment]> {
  return findScheduleConflicts(enrollments).filter(([left, right]) => termIncludes(left.academic_term, term) && termIncludes(right.academic_term, term))
}

/**
 * When two classes share a period the grid draws only the first one, so a
 * class can end up with no cell at all. Returns the class drawn in its place
 * (in its earliest period) when that happens, otherwise null.
 */
export function classCoveringHiddenEnrollment(enrollments: ScheduleEnrollment[], enrollment: ScheduleEnrollment, term: SemesterTerm): ScheduleEnrollment | null {
  const slots = sortMeetingSlots(enrollmentMeetingSlots(enrollment))
  const shownAt = slots.map((slot) => enrollmentAtSlot(enrollments, slot.day_type, slot.period_number, term))
  if (shownAt.length === 0 || shownAt.some((shown) => shown?.id === enrollment.id)) return null
  return shownAt.find((shown): shown is ScheduleEnrollment => Boolean(shown)) ?? null
}
