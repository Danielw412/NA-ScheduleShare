import type { AcademicTerm, DayType, MeetingSlot, ScheduleEnrollment } from './domain'

export type MeetingDaySelection = 'both' | DayType
export const PERIOD_NUMBERS = Array.from({ length: 9 }, (_, index) => index + 1)
const MAX_PERIOD = PERIOD_NUMBERS.length

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
  if (initial.period_number >= MAX_PERIOD) return [initial, { ...initial, period_number: MAX_PERIOD - 1 }].sort(
    (a, b) => a.period_number - b.period_number,
  )
  return [initial, { ...initial, period_number: initial.period_number + 1 }]
}

export function buildMeetingSlots(daySelection: MeetingDaySelection, period: number, isDouble: boolean): MeetingSlot[] {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) throw new Error('invalid_period')
  const days: DayType[] = daySelection === 'both' ? ['A', 'B'] : [daySelection]
  return days.flatMap((dayType) => isDouble
    ? suggestedDoubleSlots({ day_type: dayType, period_number: period })
    : [{ day_type: dayType, period_number: period }])
}

export function validateMeetingSlots(meetingSlots: MeetingSlot[], isDouble: boolean): string | null {
  if (meetingSlots.length === 0) return 'Select at least one meeting slot.'
  const uniqueSlots = new Set<string>()
  for (const slot of meetingSlots) {
    if ((slot.day_type !== 'A' && slot.day_type !== 'B') || !Number.isInteger(slot.period_number) || slot.period_number < 1 || slot.period_number > MAX_PERIOD) {
      return `Every meeting slot must use A or B day and a period from 1 through ${MAX_PERIOD}.`
    }
    const key = `${slot.day_type}-${slot.period_number}`
    if (uniqueSlots.has(key)) return 'Meeting slots cannot be duplicated.'
    uniqueSlots.add(key)
  }

  for (const dayType of ['A', 'B'] as DayType[]) {
    const periods = meetingSlots
      .filter((slot) => slot.day_type === dayType)
      .map((slot) => slot.period_number)
      .sort((left, right) => left - right)
    if (periods.length === 0) continue
    if (!isDouble && periods.length !== 1) return `Select one ${dayType}-day period for a single-period class.`
    if (isDouble && (periods.length !== 2 || periods[1] !== periods[0] + 1)) {
      return `Select exactly two consecutive ${dayType}-day periods for a double-period class.`
    }
  }
  return null
}

export function scheduleCompletion(enrollments: ScheduleEnrollment[]): number {
  const slots = new Set<string>()
  for (const enrollment of enrollments) {
    if (!enrollment.active) continue
    for (const slot of enrollment.class.meeting_slots) slots.add(`${slot.day_type}-${slot.period_number}`)
  }
  return Math.min(100, Math.round((slots.size / (PERIOD_NUMBERS.length * 2)) * 100))
}
