import type { DayType, MeetingSlot } from '../../lib/domain'
import { meetingSlotsForDay } from '../../lib/schedule'

/** "Period 4", "Periods 4–5" for consecutive periods, "Periods 2 and 6" otherwise. */
export function periodsLabel(periods: number[]): string {
  const sorted = [...new Set(periods)].sort((left, right) => left - right)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `Period ${sorted[0]}`
  const consecutive = sorted.every((period, index) => index === 0 || period === sorted[index - 1] + 1)
  if (consecutive) return `Periods ${sorted[0]}–${sorted[sorted.length - 1]}`
  return `Periods ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`
}

function periodsFor(meetingSlots: MeetingSlot[], dayType: DayType): number[] {
  return meetingSlotsForDay(meetingSlots, dayType).map((slot) => slot.period_number)
}

/**
 * Plain-language facts about when a class meets, one per chip:
 * "Period 4, A and B days" or "A day, period 4" + "B day, periods 3–4".
 */
export function meetingSlotFacts(meetingSlots: MeetingSlot[]): string[] {
  const aPeriods = periodsFor(meetingSlots, 'A')
  const bPeriods = periodsFor(meetingSlots, 'B')
  if (aPeriods.length === 0 && bPeriods.length === 0) return []
  if (aPeriods.length > 0 && aPeriods.join(',') === bPeriods.join(',')) return [`${periodsLabel(aPeriods)}, A and B days`]
  const facts: string[] = []
  if (aPeriods.length > 0) facts.push(`A day, ${periodsLabel(aPeriods).toLocaleLowerCase()}`)
  if (bPeriods.length > 0) facts.push(`B day, ${periodsLabel(bPeriods).toLocaleLowerCase()}`)
  return facts
}
