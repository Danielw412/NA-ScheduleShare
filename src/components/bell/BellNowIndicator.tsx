import { RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { useBellSchedule } from '../../features/bell/BellScheduleProvider'
import { useNow } from '../../hooks/useNow'
import { useSchedule } from '../../hooks/useSchedule'
import { resolveBellNow } from '../../lib/bellSchedule'
import { courseLine, describeBellNow } from './bellCopy'

/**
 * The live bell, always one glance away: a panel at the foot of the desktop
 * sidebar and a pill in the mobile top bar. Both open the Bell schedule page.
 */
export function BellNowIndicator({ variant }: { variant: 'sidebar' | 'pill' }) {
  const { days, status, retry } = useBellSchedule()
  const { user } = useAuth()
  const { enrollments, reload } = useSchedule()
  const { pathname } = useLocation()
  const loadedPath = useRef(pathname)
  const now = useNow(1000)

  // The shell outlives pages, so pick up schedule edits on the next navigation.
  useEffect(() => {
    if (loadedPath.current === pathname) return
    loadedPath.current = pathname
    void reload()
  }, [pathname, reload])

  if (status === 'loading') {
    return variant === 'pill'
      ? <span className="now-pill is-loading" aria-hidden="true"><span className="skeleton" /></span>
      : <div className="now-widget is-loading" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div>
  }

  if (status === 'error') {
    return variant === 'pill'
      ? <button className="now-pill is-error" type="button" onClick={retry} aria-label="Bell schedule unavailable. Try again"><RefreshCw aria-hidden="true" /></button>
      : <div className="now-widget is-error"><p>Bell schedule unavailable.</p><button className="text-button" type="button" onClick={retry}>Try again</button></div>
  }

  const bell = resolveBellNow(now, days)
  const copy = describeBellNow(bell, now, courseLine(bell, user ? enrollments : undefined, 'next'))
  const label = [copy.title, copy.countdown ? `${copy.countdown} ${copy.countdownCaption ?? ''}`.trim() : null, copy.detail, 'Open bell schedule'].filter(Boolean).join('. ')
  const progress = bell.progressPercent

  if (variant === 'pill') {
    if (bell.state === 'none') return null
    return (
      <Link className={copy.live ? 'now-pill is-live' : 'now-pill'} to="/bell" aria-label={label} viewTransition>
        {copy.mark ? <span className="now-pill-mark" aria-hidden="true">{copy.mark}</span> : null}
        <span className="now-pill-text numeric" aria-hidden="true">{copy.countdown ?? copy.compact}</span>
        {progress !== null ? <span className="now-pill-progress" aria-hidden="true" style={{ inlineSize: `${progress}%` }} /> : null}
      </Link>
    )
  }

  return (
    <Link className={copy.live ? 'now-widget is-live' : 'now-widget'} to="/bell" aria-label={label} viewTransition>
      <span className="now-widget-head" aria-hidden="true">
        <span>{bell.isToday ? 'Right now' : 'Up next'}</span>
        {bell.day?.day_type ? <span className="now-widget-day">{bell.day.day_type} day</span> : null}
      </span>
      <span className="now-widget-title" aria-hidden="true">
        {copy.mark ? <span className={copy.live ? 'period-numeral is-now' : 'period-numeral'}>{copy.mark}</span> : null}
        <span>
          <strong>{copy.title}</strong>
          <small>{copy.detail}</small>
        </span>
      </span>
      {copy.countdown ? <span className="now-widget-count numeric" aria-hidden="true">{copy.countdown}<small>{copy.countdownCaption}</small></span> : null}
      {progress !== null ? <span className="now-widget-progress" aria-hidden="true"><span style={{ inlineSize: `${progress}%` }} /></span> : null}
    </Link>
  )
}
