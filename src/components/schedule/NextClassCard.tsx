import { CalendarClock, Clock3, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BellCampus, ScheduleEnrollment, SchoolDayContext } from '../../lib/domain'
import {
  demoBellScheduleWindow,
  easternDateKey,
  formatCountdown,
  formatEasternDate,
  formatEasternTime,
  resolveBellScheduleDay,
  resolveNextClassTiming,
} from '../../lib/bellSchedule'
import { getGuestBellScheduleWindow, getMyBellScheduleWindow } from '../../lib/supabase/data'
import { BellScheduleDialog } from './BellScheduleDialog'

interface NextClassCardProps {
  enrollments: ScheduleEnrollment[]
  isDemo: boolean
  isGuest?: boolean
  campus: BellCampus
  scheduleLoading?: boolean
}

interface NextClassCardViewProps {
  enrollments: ScheduleEnrollment[]
  campus: BellCampus
  days: SchoolDayContext[]
  now: Date
}

export function NextClassCard({ enrollments, isDemo, isGuest = false, campus, scheduleLoading = false }: NextClassCardProps) {
  const [now, setNow] = useState(() => new Date())
  const [startDate, setStartDate] = useState(() => easternDateKey(new Date()))
  const [days, setDays] = useState<SchoolDayContext[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const request = isDemo
      ? Promise.resolve(demoBellScheduleWindow(startDate, 21, campus))
      : isGuest
        ? getGuestBellScheduleWindow(startDate, 21, campus)
        : getMyBellScheduleWindow(startDate, 21)
    void request.then((value) => {
      if (!active) return
      setDays(value)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError('Your school-day calendar could not be loaded.')
      setLoading(false)
    })
    return () => { active = false }
  }, [campus, isDemo, isGuest, retry, startDate])

  useEffect(() => {
    let timer: number | null = null
    const tick = () => {
      const nextNow = new Date()
      setNow(nextNow)
      setStartDate((current) => easternDateKey(nextNow) === current ? current : easternDateKey(nextNow))
    }
    const startTimer = () => {
      if (timer !== null || document.visibilityState === 'hidden') return
      timer = window.setInterval(tick, 1000)
    }
    const stopTimer = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopTimer()
      else {
        tick()
        startTimer()
      }
    }
    startTimer()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  if (loading || scheduleLoading) {
    return <section className="next-class-card is-loading" aria-label="Next class"><Clock3 aria-hidden="true" /><div><h2>Finding your next class…</h2><p>Loading today’s bell schedule.</p></div></section>
  }

  if (error) {
    return <section className="next-class-card is-error" aria-label="Next class"><Clock3 aria-hidden="true" /><div><h2>Next class unavailable</h2><p>{error}</p></div><button className="icon-button" type="button" aria-label="Retry next class" onClick={() => setRetry((value) => value + 1)}><RefreshCw aria-hidden="true" /></button></section>
  }

  return <NextClassCardView enrollments={isGuest ? [] : enrollments} campus={campus} days={days} now={now} />
}

export function NextClassCardView({ enrollments, campus, days, now }: NextClassCardViewProps) {
  const timing = useMemo(() => resolveNextClassTiming(now, days, enrollments), [days, enrollments, now])
  const displayDay = useMemo(() => resolveBellScheduleDay(now, days), [days, now])
  const resolvedCampus = days[0]?.campus ?? campus
  const courseCopy = timing.courseName && timing.mode === 'current'
    ? `Time until ${timing.courseName} is over`
    : timing.courseName
      ? `Time until ${timing.courseName} starts`
      : 'Time until next class'
  const [courseCopyFits, setCourseCopyFits] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const titleWrapRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const scheduleButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const wrap = titleWrapRef.current
    const measure = measureRef.current
    if (!wrap || !measure) return
    const check = () => setCourseCopyFits(measure.scrollWidth <= wrap.clientWidth)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [courseCopy])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    scheduleButtonRef.current?.focus()
  }, [])

  const scheduleButton = displayDay ? <button
    ref={scheduleButtonRef}
    className="button button-secondary next-class-schedule-button"
    type="button"
    onClick={() => setDialogOpen(true)}
  ><CalendarClock size={16} aria-hidden="true" /> View bell schedule</button> : null
  const dialog = dialogOpen && displayDay ? <BellScheduleDialog day={displayDay} now={now} onClose={closeDialog} /> : null

  if (timing.status === 'none' || !timing.targetAt) {
    return <><section className="next-class-card" aria-label="Next class"><Clock3 aria-hidden="true" /><div className="next-class-main"><h2>No upcoming classes.</h2><p>There are no future class days in the configured school year.</p></div>{scheduleButton ? <div className="next-class-actions">{scheduleButton}</div> : null}</section>{dialog}</>
  }

  if (timing.status === 'upcoming') {
    return <><section className="next-class-card" aria-label="Next class"><Clock3 aria-hidden="true" /><div className="next-class-main"><h2>Next class: {formatEasternDate(timing.targetAt)}</h2><p>Starts at {formatEasternTime(timing.targetAt)} · {resolvedCampus}</p></div>{scheduleButton ? <div className="next-class-actions">{scheduleButton}</div> : null}</section>{dialog}</>
  }

  const genericCopy = 'Time until next class'
  const visibleCopy = timing.courseName && courseCopyFits ? courseCopy : genericCopy
  const targetVerb = timing.mode === 'current' ? 'Ends' : 'Starts'
  const progress = timing.progressPercent ?? 0
  return <><section className="next-class-card is-live" aria-label="Next class">
    <Clock3 aria-hidden="true" />
    <div className="next-class-main">
      <div className="next-class-title-wrap" ref={titleWrapRef}>
        <span className="next-class-measure" ref={measureRef} aria-hidden="true">{courseCopy}</span>
        <h2 title={visibleCopy === genericCopy && timing.courseName ? courseCopy : undefined}><span>{visibleCopy}:</span> <strong>{formatCountdown(timing.remainingMs ?? 0)}</strong></h2>
      </div>
      <p>{targetVerb} at {formatEasternTime(timing.targetAt)} · {resolvedCampus}</p>
    </div>
    <div className="next-class-actions"><span className="next-class-progress-copy" aria-hidden="true">{Math.round(progress)}%</span>{scheduleButton}</div>
    <div
      className="next-class-progress"
      role="progressbar"
      aria-label={timing.mode === 'current' ? 'Current block progress' : 'Progress until next class'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
    ><span style={{ width: `${progress}%` }} /></div>
  </section>{dialog}</>
}
