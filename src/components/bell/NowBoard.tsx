import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ScheduleEnrollment } from '../../lib/domain'
import {
  blockMark,
  blockTimes,
  blockTitle,
  easternDateKey,
  formatCountdown,
  formatEasternTime,
  LIVE_COUNTDOWN_THRESHOLD_MS,
  orderedBlocks,
  type BellNow,
  type NextClassTiming,
} from '../../lib/bellSchedule'
import { courseLine, describeBellNow } from './bellCopy'

interface NowBoardProps {
  bell: BellNow
  now: Date
  /** The student's classes; omit for guests so no class names appear. */
  enrollments?: ScheduleEnrollment[]
  /** The student's own next class today (skipping free periods), from resolveNextClassTiming. */
  nextClass?: NextClassTiming | null
  variant: 'hero' | 'strip'
}

/**
 * The live state of the school day. As the homepage hero it is the largest
 * thing on screen; as a strip it is a single tappable line.
 */
export function NowBoard({ bell, now, enrollments, nextClass, variant }: NowBoardProps) {
  const currentCourse = courseLine(bell, enrollments, 'current')
  const nextCourse = courseLine(bell, enrollments, 'next')
  const copy = describeBellNow(bell, now, nextCourse)
  const progress = bell.progressPercent
  const live = copy.live
  const showsNextRow = bell.state === 'in_block' && bell.next && bell.day
  const ownClassNow = bell.state === 'in_block' && Boolean(currentCourse) && currentCourse !== 'No class'
  // During a free period, before school, or between bells, point at the
  // student's own next class today rather than the next bell.
  // Only when it skips ahead: if the very next bell is the student's class,
  // the board already says so.
  const nextBellStart = bell.next && bell.day ? blockTimes(bell.day, bell.next).start.getTime() : null
  const personal = !ownClassNow && nextClass?.mode === 'next' && nextClass.courseName && nextClass.targetAt
    && nextClass.targetDate === easternDateKey(now) && bell.day
    && nextClass.targetAt.getTime() !== nextBellStart
    ? {
        course: nextClass.courseName,
        startsAt: nextClass.targetAt,
        countdown: nextClass.remainingMs !== null && nextClass.remainingMs < LIVE_COUNTDOWN_THRESHOLD_MS ? formatCountdown(nextClass.remainingMs) : null,
        progress: nextClass.progressPercent,
        block: orderedBlocks(bell.day).find((block) => blockTimes(bell.day!, block).start.getTime() === nextClass.targetAt!.getTime()) ?? null,
      }
    : null

  if (variant === 'strip') {
    // Lead with the student's class when there is one; the bell is the context.
    const inBlock = bell.state === 'in_block'
    const upcoming = bell.state === 'passing' || bell.state === 'before_school'
    const headline = inBlock && currentCourse && currentCourse !== 'No class' ? currentCourse : copy.title
    const detail = inBlock && headline !== copy.title
      ? `${copy.title}, ${copy.detail.charAt(0).toLowerCase()}${copy.detail.slice(1)}`
      : personal
        ? `${inBlock ? 'No class now. ' : ''}${personal.course} starts at ${formatEasternTime(personal.startsAt)}`
        : upcoming && nextCourse && nextCourse !== 'No class' && bell.targetAt
          ? `${nextCourse} starts at ${formatEasternTime(bell.targetAt)}`
          : copy.detail
    // When the detail names a later class, the countdown is to that class.
    const countdown = personal ? personal.countdown : copy.countdown
    const countdownCaption = personal ? `until ${personal.course}` : copy.countdownCaption
    const stripProgress = personal ? personal.progress : progress
    return (
      <Link className={live ? 'now-strip is-live' : 'now-strip'} to="/bell" viewTransition>
        {copy.mark ? <span className={live ? 'period-numeral is-now' : 'period-numeral'} aria-hidden="true">{copy.mark}</span> : null}
        <span className="now-strip-text">
          <strong>{headline}</strong>
          <small>{detail}</small>
        </span>
        {countdown ? <span className="now-strip-count numeric"><span className="sr-only">{`Time ${countdownCaption ?? 'remaining'}: `}</span>{countdown}</span> : null}
        <ChevronRight className="now-strip-chevron" aria-hidden="true" />
        {stripProgress !== null ? <span className="now-strip-progress" aria-hidden="true"><span style={{ inlineSize: `${stripProgress}%` }} /></span> : null}
      </Link>
    )
  }

  const bigValue = copy.countdown ?? (bell.targetAt && !bell.isToday ? formatEasternTime(bell.targetAt).replace(/\s?[AP]M$/, '') : null)
  const bigCaption = copy.countdown
    ? copy.countdownCaption
    : bell.targetAt && !bell.isToday ? `${formatEasternTime(bell.targetAt).slice(-2)} first bell` : null

  return (
    <section className={live ? 'now-board is-live' : 'now-board'} aria-labelledby="now-board-title">
      <div className="now-board-head">
        {copy.mark ? <span className={live ? 'now-board-mark is-now' : 'now-board-mark'} aria-hidden="true">{copy.mark}</span> : null}
        <div>
          <h2 id="now-board-title">{copy.title}</h2>
          {bell.state === 'in_block' && currentCourse ? <p className="now-board-course">{currentCourse}</p> : null}
          {(bell.state === 'passing' || bell.state === 'before_school') && nextCourse ? <p className="now-board-course">Next: {nextCourse}</p> : null}
        </div>
      </div>

      {bigValue ? (
        <p className="now-board-count numeric">
          <span className="now-board-count-value">{bigValue}</span>
          {bigCaption ? <span className="now-board-count-caption">{bigCaption}</span> : null}
        </p>
      ) : null}

      {progress !== null ? (
        <div
          className="now-board-progress"
          role="progressbar"
          aria-label={bell.state === 'in_block' ? `${copy.title} progress` : `Time ${copy.countdownCaption ?? 'until the next bell'}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        ><span style={{ inlineSize: `${progress}%` }} /></div>
      ) : null}

      <p className="now-board-detail">{copy.detail}.</p>

      {personal ? (
        <div className="now-board-next is-personal">
          <span className="now-board-next-label">Your next class</span>
          {personal.block ? <span className="period-numeral" aria-hidden="true">{blockMark(personal.block)}</span> : <span aria-hidden="true" />}
          <span className="now-board-next-text">
            <strong>{personal.course}</strong>
            <span>{personal.countdown ? `Starts in ${personal.countdown}` : `Starts at ${formatEasternTime(personal.startsAt)}`}</span>
          </span>
          <span className="now-board-next-time numeric">{formatEasternTime(personal.startsAt)}</span>
        </div>
      ) : showsNextRow && bell.next && bell.day ? (
        <div className="now-board-next">
          <span className="now-board-next-label">Then</span>
          <span className={bell.next.kind === 'class' ? 'period-numeral' : 'period-numeral is-muted'} aria-hidden="true">{blockMark(bell.next)}</span>
          <span className="now-board-next-text">
            <strong>{blockTitle(bell.next)}</strong>
            {nextCourse ? <span>{nextCourse}</span> : null}
          </span>
          <span className="now-board-next-time numeric">{formatEasternTime(blockTimes(bell.day, bell.next).start)}</span>
        </div>
      ) : null}
    </section>
  )
}
