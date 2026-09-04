import type {
  BellCampus,
  BellScheduleBlock,
  BellScheduleDefinition,
  DayType,
  ScheduleEnrollment,
  SchoolDayContext,
} from './domain'
import { enrollmentMeetingSlots, termIncludes } from './schedule'

export const SCHOOL_TIME_ZONE = 'America/New_York'
export const LIVE_COUNTDOWN_THRESHOLD_MS = 2 * 60 * 60 * 1000

export interface NextClassTiming {
  status: 'live' | 'upcoming' | 'none'
  mode: 'current' | 'next' | null
  currentBlockKind: BellScheduleBlock['kind'] | null
  courseName: string | null
  targetAt: Date | null
  intervalStart: Date | null
  remainingMs: number | null
  progressPercent: number | null
  targetDate: string | null
}

const easternPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const easternOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TIME_ZONE,
  timeZoneName: 'longOffset',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

function formattedParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    easternPartsFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

export function easternDateKey(date: Date): string {
  const parts = formattedParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function easternTimeKey(date: Date): string {
  const parts = formattedParts(date)
  return `${parts.hour}:${parts.minute}`
}

export function easternLocalTime(dateKey: string, time: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) throw new Error('invalid_eastern_local_time')
  const utcGuess = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  )
  const offsetName = easternOffsetFormatter.formatToParts(new Date(utcGuess))
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-05:00'
  const offsetMatch = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetName)
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1] === '+' ? 1 : -1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]))
    : -300
  return new Date(utcGuess - offsetMinutes * 60_000)
}

export function formatEasternTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SCHOOL_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatEasternDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SCHOOL_TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const trailingSeconds = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(trailingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(trailingSeconds).padStart(2, '0')}`
}

function enrollmentsAtPeriod(
  enrollments: ScheduleEnrollment[],
  dayType: DayType,
  periodNumber: number,
  semester: SchoolDayContext['semester'],
): ScheduleEnrollment[] {
  return enrollments.filter((enrollment) => enrollment.active
    && termIncludes(enrollment.academic_term, semester)
    && enrollmentMeetingSlots(enrollment).some(
      (slot) => slot.day_type === dayType && slot.period_number === periodNumber,
    ))
}

function classAtBlock(
  day: SchoolDayContext,
  periodNumber: number | null,
  enrollments: ScheduleEnrollment[],
): { occupied: boolean; courseName: string | null } {
  if (periodNumber === null || day.day_type === null) return { occupied: false, courseName: null }
  const matches = enrollmentsAtPeriod(enrollments, day.day_type, periodNumber, day.semester)
  return {
    occupied: matches.length > 0,
    courseName: matches.length === 1 ? matches[0].class.course_name.trim() || null : null,
  }
}

function progressFor(now: Date, start: Date, end: Date): number {
  const duration = end.getTime() - start.getTime()
  if (duration <= 0) return 0
  return Math.max(0, Math.min(100, ((now.getTime() - start.getTime()) / duration) * 100))
}

function phaseStartForNextClass(
  now: Date,
  day: SchoolDayContext,
  targetPosition: number,
): Date {
  const schedule = day.schedule
  if (!schedule) return now
  const blocks = [...schedule.blocks].sort((left, right) => left.position - right.position)
  const containing = blocks.find((block) => {
    const start = easternLocalTime(day.date, block.start_time).getTime()
    const end = easternLocalTime(day.date, block.end_time).getTime()
    return now.getTime() >= start && now.getTime() < end && block.position < targetPosition
  })
  if (containing) return easternLocalTime(day.date, containing.start_time)
  const prior = blocks
    .filter((block) => block.position < targetPosition && easternLocalTime(day.date, block.end_time).getTime() <= now.getTime())
    .at(-1)
  if (prior) return easternLocalTime(day.date, prior.end_time)
  return easternLocalTime(day.date, schedule.warning_time ?? blocks[0]?.start_time ?? '00:00')
}

export function resolveNextClassTiming(
  now: Date,
  days: SchoolDayContext[],
  enrollments: ScheduleEnrollment[],
): NextClassTiming {
  const nowTime = now.getTime()
  const today = easternDateKey(now)
  const orderedDays = [...days].sort((left, right) => left.date.localeCompare(right.date))

  for (const day of orderedDays) {
    if (day.date < today || day.no_school || !day.schedule) continue
    const blocks = [...day.schedule.blocks].sort((left, right) => left.position - right.position)
    if (day.date === today) {
      const currentBlock = blocks.find((block) => {
        const start = easternLocalTime(day.date, block.start_time).getTime()
        const end = easternLocalTime(day.date, block.end_time).getTime()
        return nowTime >= start && nowTime < end
      })
      if (currentBlock?.kind === 'non_class') {
        const start = easternLocalTime(day.date, currentBlock.start_time)
        const target = easternLocalTime(day.date, currentBlock.end_time)
        return {
          status: 'live',
          mode: 'current',
          currentBlockKind: 'non_class',
          courseName: currentBlock.label.trim() || null,
          targetAt: target,
          intervalStart: start,
          remainingMs: target.getTime() - nowTime,
          progressPercent: progressFor(now, start, target),
          targetDate: day.date,
        }
      }
      if (currentBlock?.kind === 'class') {
        const course = classAtBlock(day, currentBlock.period_number, enrollments)
        if (day.day_type === null || course.occupied) {
          const start = easternLocalTime(day.date, currentBlock.start_time)
          const target = easternLocalTime(day.date, currentBlock.end_time)
          return {
            status: 'live',
            mode: 'current',
            currentBlockKind: 'class',
            courseName: course.courseName,
            targetAt: target,
            intervalStart: start,
            remainingMs: target.getTime() - nowTime,
            progressPercent: progressFor(now, start, target),
            targetDate: day.date,
          }
        }
      }
    }

    const futureClassBlocks = blocks.filter((block) => block.kind === 'class'
      && easternLocalTime(day.date, block.start_time).getTime() > nowTime)
    if (futureClassBlocks.length === 0) continue
    let targetBlock = futureClassBlocks[0]
    let courseName: string | null = null
    if (day.day_type !== null) {
      const occupied = futureClassBlocks.find((block) => classAtBlock(day, block.period_number, enrollments).occupied)
      if (occupied) {
        targetBlock = occupied
        courseName = classAtBlock(day, occupied.period_number, enrollments).courseName
      }
    }
    const target = easternLocalTime(day.date, targetBlock.start_time)
    const remainingMs = target.getTime() - nowTime
    const live = remainingMs < LIVE_COUNTDOWN_THRESHOLD_MS
    const intervalStart = phaseStartForNextClass(now, day, targetBlock.position)
    return {
      status: live ? 'live' : 'upcoming',
      mode: 'next',
      currentBlockKind: null,
      courseName,
      targetAt: target,
      intervalStart,
      remainingMs,
      progressPercent: live ? progressFor(now, intervalStart, target) : null,
      targetDate: day.date,
    }
  }

  return {
    status: 'none',
    mode: null,
    currentBlockKind: null,
    courseName: null,
    targetAt: null,
    intervalStart: null,
    remainingMs: null,
    progressPercent: null,
    targetDate: null,
  }
}

export function resolveBellScheduleDay(now: Date, days: SchoolDayContext[]): SchoolDayContext | null {
  const today = easternDateKey(now)
  return [...days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .find((day) => day.date >= today && !day.no_school && day.schedule !== null) ?? null
}

const demoRegularSchedule: BellScheduleDefinition = {
  id: 'demo-regular',
  schedule_key: 'regular',
  display_name: 'Regular',
  campus_scope: 'BOTH',
  warning_time: '07:24',
  is_builtin: true,
  archived_at: null,
  updated_at: '',
  blocks: [
    [1, 'class', 'Period 1', 1, '07:28', '08:08'],
    [2, 'non_class', 'Homeroom', null, '08:08', '08:21'],
    [3, 'class', 'Period 2', 2, '08:25', '09:05'],
    [4, 'class', 'Period 3', 3, '09:09', '09:49'],
    [5, 'class', 'Period 4', 4, '09:53', '10:33'],
    [6, 'class', 'Period 5', 5, '10:37', '11:17'],
    [7, 'class', 'Period 6', 6, '11:21', '12:01'],
    [8, 'class', 'Period 7', 7, '12:05', '12:45'],
    [9, 'class', 'Period 8', 8, '12:49', '13:29'],
    [10, 'class', 'Period 9', 9, '13:33', '14:15'],
  ].map(([position, kind, label, periodNumber, startTime, endTime]) => ({
    position: position as number,
    kind: kind as BellScheduleBlock['kind'],
    label: label as string,
    period_number: periodNumber as number | null,
    start_time: startTime as string,
    end_time: endTime as string,
  })),
}

function addDateDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function demoDayType(dateKey: string): DayType {
  let cursor = '2026-08-18'
  let schoolDayCount = 0
  while (cursor < dateKey) {
    const day = new Date(`${cursor}T12:00:00Z`).getUTCDay()
    if (day !== 0 && day !== 6) schoolDayCount += 1
    cursor = addDateDays(cursor, 1)
  }
  return schoolDayCount % 2 === 0 ? 'A' : 'B'
}

export function demoBellScheduleWindow(startDate: string, days = 21, campus: BellCampus = 'NASH'): SchoolDayContext[] {
  return Array.from({ length: days }, (_, index) => {
    const date = addDateDays(startDate, index)
    const weekDay = new Date(`${date}T12:00:00Z`).getUTCDay()
    const inYear = date >= '2026-08-18' && date <= '2027-05-28'
    const noSchool = !inYear || weekDay === 0 || weekDay === 6
    return {
      date,
      campus,
      day_type: noSchool ? null : demoDayType(date),
      semester: date >= '2027-01-12' ? 'semester_2' : 'semester_1',
      no_school: noSchool,
      source: 'default',
      schedule: noSchool ? null : demoRegularSchedule,
    }
  })
}
