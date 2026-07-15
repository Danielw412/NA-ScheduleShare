import type { AcademicTerm, MeetingSlot, ScheduleEnrollment } from './domain'

export function termsOverlap(left: AcademicTerm, right: AcademicTerm): boolean {
  return left === 'full_year' || right === 'full_year' || left === right
}

export function termIncludes(enrollment: AcademicTerm, selected: AcademicTerm): boolean {
  return selected === 'full_year' ? true : enrollment === 'full_year' || enrollment === selected
}

export function sameSlot(left: MeetingSlot, right: MeetingSlot): boolean {
  return left.day_type === right.day_type && left.period_number === right.period_number
}

export function findScheduleConflicts(enrollments: ScheduleEnrollment[]): Array<[ScheduleEnrollment, ScheduleEnrollment]> {
  const conflicts: Array<[ScheduleEnrollment, ScheduleEnrollment]> = []
  for (let leftIndex = 0; leftIndex < enrollments.length; leftIndex += 1) {
    const left = enrollments[leftIndex]
    if (!left.active) continue
    for (let rightIndex = leftIndex + 1; rightIndex < enrollments.length; rightIndex += 1) {
      const right = enrollments[rightIndex]
      if (!right.active || !termsOverlap(left.academic_term, right.academic_term)) continue
      if (left.class.meeting_slots.some((slot) => right.class.meeting_slots.some((candidate) => sameSlot(slot, candidate)))) {
        conflicts.push([left, right])
      }
    }
  }
  return conflicts
}

export function enrollmentAtSlot(
  enrollments: ScheduleEnrollment[],
  dayType: 'A' | 'B',
  period: number,
  selectedTerm: AcademicTerm,
): ScheduleEnrollment | undefined {
  return enrollments.find(
    (enrollment) =>
      enrollment.active &&
      termIncludes(enrollment.academic_term, selectedTerm) &&
      enrollment.class.meeting_slots.some((slot) => slot.day_type === dayType && slot.period_number === period),
  )
}

export function suggestedDoubleSlots(initial: MeetingSlot): MeetingSlot[] {
  if (initial.period_number >= 8) return [initial, { ...initial, period_number: 7 }].sort(
    (a, b) => a.period_number - b.period_number,
  )
  return [initial, { ...initial, period_number: initial.period_number + 1 }]
}

export function scheduleCompletion(enrollments: ScheduleEnrollment[]): number {
  const slots = new Set<string>()
  for (const enrollment of enrollments) {
    if (!enrollment.active) continue
    for (const slot of enrollment.class.meeting_slots) slots.add(`${slot.day_type}-${slot.period_number}`)
  }
  return Math.min(100, Math.round((slots.size / 16) * 100))
}
