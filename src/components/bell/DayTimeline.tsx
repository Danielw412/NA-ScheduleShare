import type { ScheduleEnrollment, SchoolDayContext } from '../../lib/domain'
import {
  blockMark,
  blockTimes,
  blockTitle,
  coursesAtBlock,
  easternDateKey,
  formatEasternTimeRange,
  orderedBlocks,
} from '../../lib/bellSchedule'

interface DayTimelineProps {
  day: SchoolDayContext
  now: Date
  /** The student's classes. Omit for guests: the timeline then shows bells only. */
  enrollments?: ScheduleEnrollment[]
  label?: string
  className?: string
}

/**
 * One school day as an ordered run of bells. The current block carries the
 * gold numeral and a live progress rule; finished blocks recede.
 */
export function DayTimeline({ day, now, enrollments, label, className }: DayTimelineProps) {
  const isToday = day.date === easternDateKey(now)
  const nowTime = now.getTime()
  const showCourses = enrollments !== undefined
  // Without an A/B day the student's classes cannot be placed, so no line is
  // better than a wrong "No class".
  const hasSchedule = day.day_type !== null && Boolean(enrollments?.some((enrollment) => enrollment.active))
  const blocks = orderedBlocks(day)
  const nextIndex = isToday ? blocks.findIndex((block) => blockTimes(day, block).start.getTime() > nowTime) : -1

  return (
    <ol className={className ? `timeline ${className}` : 'timeline'} aria-label={label ?? 'Bell schedule'}>
      {blocks.map((block, index) => {
        const { start, end } = blockTimes(day, block)
        const isNow = isToday && nowTime >= start.getTime() && nowTime < end.getTime()
        const isPast = isToday && nowTime >= end.getTime()
        const isNext = !isNow && index === nextIndex
        const courses = showCourses ? coursesAtBlock(day, block, enrollments ?? []) : []
        const progress = isNow ? Math.min(100, Math.max(0, ((nowTime - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : 0
        const rowClass = ['timeline-row', block.kind === 'class' ? 'is-class' : 'is-break', isNow ? 'is-now' : '', isPast ? 'is-past' : '', isNext ? 'is-next' : ''].filter(Boolean).join(' ')
        const courseText = courses.length === 1
          ? courses[0].class.course_name
          : courses.length > 1
            ? courses.map((course) => course.class.course_name).join(' / ')
            : null

        return (
          <li className={rowClass} key={`${block.position}-${block.label}`} aria-current={isNow ? 'time' : undefined}>
            <span className={isNow ? 'period-numeral is-now' : block.kind === 'class' ? 'period-numeral' : 'period-numeral is-muted'} aria-hidden="true">{blockMark(block)}</span>
            <span className="timeline-main">
              <strong>{blockTitle(block)}{isNow ? <span className="sr-only">, happening now</span> : null}</strong>
              {showCourses && block.kind === 'class'
                ? courseText
                  ? <span className="timeline-course">{courseText}</span>
                  : hasSchedule ? <span className="timeline-course is-free">No class</span> : null
                : null}
            </span>
            <span className="timeline-time numeric">{formatEasternTimeRange(start, end)}</span>
            {isNow ? <span className="timeline-progress" aria-hidden="true"><span style={{ inlineSize: `${progress}%` }} /></span> : null}
          </li>
        )
      })}
    </ol>
  )
}
