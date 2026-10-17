import type { ScheduleEnrollment } from '../../lib/domain'
import {
  daysFromToday,
  blockMark,
  blockTitle,
  coursesAtBlock,
  formatCountdown,
  formatEasternDayLabel,
  formatEasternTime,
  formatEasternWeekday,
  LIVE_COUNTDOWN_THRESHOLD_MS,
  type BellNow,
} from '../../lib/bellSchedule'

export interface BellNowCopy {
  /** Short mark for the numeral badge: period number or a block initial. */
  mark: string | null
  /** "Period 3", "Lunch", "Passing time", "School's out". */
  title: string
  /** One plain sentence with the exact time. */
  detail: string
  /** Live countdown, or null when the next bell is too far away to matter. */
  countdown: string | null
  /** What the countdown counts toward, for screen readers and captions. */
  countdownCaption: string | null
  /** Compact text for the mobile pill when there is no countdown. */
  compact: string
  live: boolean
}

/**
 * The student's class during the current or next bell: course names, "No
 * class" for a free period, or null when it can't be known (guests, non-class
 * blocks, or no A/B day).
 */
export function courseLine(bell: BellNow, enrollments: ScheduleEnrollment[] | undefined, which: 'current' | 'next'): string | null {
  const block = which === 'current' ? bell.current : bell.next
  // Without an A/B day the student's class for a period is unknown; say nothing
  // rather than "No class".
  if (!enrollments || !bell.day || !block || block.kind !== 'class' || bell.day.day_type === null) return null
  const courses = coursesAtBlock(bell.day, block, enrollments)
  if (courses.length > 0) return courses.map((course) => course.class.course_name).join(' / ')
  return enrollments.some((enrollment) => enrollment.active) ? 'No class' : null
}

/**
 * @param nextCourse The student's class at the next bell, so the countdown
 * reads "until Chemistry" rather than "until Period 3".
 */
export function describeBellNow(bell: BellNow, now: Date, nextCourse?: string | null): BellNowCopy {
  const remaining = bell.remainingMs
  const countdown = remaining !== null && remaining < LIVE_COUNTDOWN_THRESHOLD_MS ? formatCountdown(remaining) : null

  if (bell.state === 'in_block' && bell.current && bell.targetAt) {
    return {
      mark: blockMark(bell.current),
      title: blockTitle(bell.current),
      detail: `Ends at ${formatEasternTime(bell.targetAt)}`,
      countdown,
      countdownCaption: 'left',
      compact: blockTitle(bell.current),
      live: true,
    }
  }

  if ((bell.state === 'passing' || bell.state === 'before_school') && bell.next && bell.targetAt) {
    const nextTitle = blockTitle(bell.next)
    const countdownTarget = nextCourse && nextCourse !== 'No class' ? nextCourse : nextTitle
    return {
      mark: blockMark(bell.next),
      title: bell.state === 'passing' ? 'Passing time' : 'Before school',
      detail: `${nextTitle} starts at ${formatEasternTime(bell.targetAt)}`,
      countdown,
      countdownCaption: countdown ? `until ${countdownTarget}` : null,
      compact: `${nextTitle} at ${formatEasternTime(bell.targetAt)}`,
      live: countdown !== null,
    }
  }

  if ((bell.state === 'after_school' || bell.state === 'no_school') && bell.day && bell.targetAt && !bell.isToday) {
    const dayLabel = formatEasternDayLabel(bell.day.date, now)
    return {
      mark: null,
      title: bell.state === 'after_school' ? 'School’s out' : 'No school today',
      detail: `Next school day is ${dayLabel.toLowerCase() === 'tomorrow' ? 'tomorrow' : dayLabel}, starting at ${formatEasternTime(bell.targetAt)}`,
      countdown: null,
      countdownCaption: null,
      compact: daysFromToday(bell.day.date, now) < 7
        ? `${formatEasternWeekday(bell.targetAt, 'short')} ${formatEasternTime(bell.targetAt)}`
        : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(bell.targetAt),
      live: false,
    }
  }

  if (bell.state === 'after_school') {
    return { mark: null, title: 'School’s out', detail: 'No more school days are on the calendar yet.', countdown: null, countdownCaption: null, compact: 'Done', live: false }
  }

  return { mark: null, title: 'No school days ahead', detail: 'The bell calendar has no upcoming school days.', countdown: null, countdownCaption: null, compact: 'No school', live: false }
}
