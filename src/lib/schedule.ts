import type { AcademicTerm, DayType, MeetingSlot, ScheduleEnrollment } from './domain'

export const PERIOD_NUMBERS = Array.from({ length: 9 }, (_, index) => index + 1)
const MAX_PERIOD = PERIOD_NUMBERS.length
export type MeetingDaySelection = 'both' | DayType

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

export function sortMeetingSlots(meetingSlots: MeetingSlot[]): MeetingSlot[] {
  return [...meetingSlots].sort(
    (left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number,
  )
}

export function compactMeetingSlotLabels(meetingSlots: MeetingSlot[]): string[] {
  const daysByPeriod = new Map<number, Set<DayType>>()
  for (const slot of meetingSlots) {
    const days = daysByPeriod.get(slot.period_number) ?? new Set<DayType>()
    days.add(slot.day_type)
    daysByPeriod.set(slot.period_number, days)
  }
  return [...daysByPeriod.entries()]
    .sort(([left], [right]) => left - right)
    .map(([period, days]) => days.has('A') && days.has('B')
      ? `P${period}`
      : `${days.has('A') ? 'A' : 'B'} P${period}`)
}

export function defaultMeetingSlots(dayType: DayType, period: number): MeetingSlot[] {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) throw new Error('invalid_period')
  const otherDay: DayType = dayType === 'A' ? 'B' : 'A'
  return sortMeetingSlots([
    { day_type: dayType, period_number: period },
    { day_type: otherDay, period_number: period },
  ])
}

export function buildNormalMeetingSlots(daySelection: MeetingDaySelection, period: number): MeetingSlot[] {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) throw new Error('invalid_period')
  const days: DayType[] = daySelection === 'both' ? ['A', 'B'] : [daySelection]
  return days.map((dayType) => ({ day_type: dayType, period_number: period }))
}

export function defaultDoubleMeetingSlots(dayType: DayType, period: number): MeetingSlot[] {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) throw new Error('invalid_period')
  const continuationPeriod = period === MAX_PERIOD ? period - 1 : period + 1
  const otherDay: DayType = dayType === 'A' ? 'B' : 'A'
  return sortMeetingSlots([
    { day_type: dayType, period_number: Math.min(period, continuationPeriod) },
    { day_type: dayType, period_number: Math.max(period, continuationPeriod) },
    { day_type: otherDay, period_number: period },
  ])
}

export function toggleMeetingSlot(meetingSlots: MeetingSlot[], slot: MeetingSlot): MeetingSlot[] {
  return meetingSlots.some((candidate) => sameSlot(candidate, slot))
    ? meetingSlots.filter((candidate) => !sameSlot(candidate, slot))
    : sortMeetingSlots([...meetingSlots, slot])
}

export function meetingSlotsForDay(meetingSlots: MeetingSlot[], dayType: DayType): MeetingSlot[] {
  return meetingSlots
    .filter((slot) => slot.day_type === dayType)
    .sort((left, right) => left.period_number - right.period_number)
}

export function meetingDaySelectionFromSlots(meetingSlots: MeetingSlot[]): MeetingDaySelection {
  const days = new Set(meetingSlots.map((slot) => slot.day_type))
  if (days.has('A') && days.has('B')) return 'both'
  return days.has('A') ? 'A' : days.has('B') ? 'B' : 'both'
}

export function meetingPeriodFromSlots(meetingSlots: MeetingSlot[], fallback = 1): number {
  return sortMeetingSlots(meetingSlots)[0]?.period_number ?? fallback
}

export function hasMultiplePeriodsOnAnyDay(meetingSlots: MeetingSlot[]): boolean {
  return (['A', 'B'] as DayType[]).some((dayType) => meetingSlotsForDay(meetingSlots, dayType).length > 1)
}

export function isMeetingSlotContinuation(meetingSlots: MeetingSlot[], slot: MeetingSlot): boolean {
  return meetingSlots.some(
    (candidate) => candidate.day_type === slot.day_type && candidate.period_number === slot.period_number - 1,
  )
}

export function formatMeetingSlotSummary(meetingSlots: MeetingSlot[]): string {
  return compactMeetingSlotLabels(meetingSlots).join(' · ')
}

export function validateMeetingSlots(meetingSlots: MeetingSlot[], isDoublePeriod = hasMultiplePeriodsOnAnyDay(meetingSlots)): string | null {
  if (meetingSlots.length === 0) return 'Select at least one meeting slot.'
  if (meetingSlots.length > 4) return 'A class can use at most four meeting slots.'
  const uniqueSlots = new Set<string>()
  for (const slot of meetingSlots) {
    if ((slot.day_type !== 'A' && slot.day_type !== 'B') || !Number.isInteger(slot.period_number) || slot.period_number < 1 || slot.period_number > MAX_PERIOD) {
      return `Every meeting slot must use A or B day and a period from 1 through ${MAX_PERIOD}.`
    }
    const key = `${slot.day_type}-${slot.period_number}`
    if (uniqueSlots.has(key)) return 'Meeting slots cannot be duplicated.'
    uniqueSlots.add(key)
  }

  const daySlotCounts = (['A', 'B'] as DayType[]).map((dayType) => meetingSlotsForDay(meetingSlots, dayType))
  if (!isDoublePeriod && daySlotCounts.some((daySlots) => daySlots.length > 1)) {
    return 'A normal class can use only one period on each selected day.'
  }
  if (isDoublePeriod) {
    let hasDoublePeriodDay = false
    for (const daySlots of daySlotCounts) {
      if (daySlots.length > 2) return 'A double-period class can use at most two consecutive periods on each day.'
      if (daySlots.length !== 2) continue
      if (daySlots[1].period_number !== daySlots[0].period_number + 1) {
        return 'Double-period selections must use consecutive periods on each day.'
      }
      hasDoublePeriodDay = true
    }
    if (!hasDoublePeriodDay) return 'Select two consecutive periods on at least one meeting day for a double-period class.'
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
