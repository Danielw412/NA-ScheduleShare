import { ArrowRight, CalendarDays, ChevronRight, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import { clearAuthDestination, hasPendingAuthDestination, pendingAuthDestination } from '../lib/authDestination'
import type { HomepageStatistic } from '../lib/domain'
import { scheduleCompletion } from '../lib/schedule'
import { createScheduleShareUrl, scheduleShareTitle } from '../lib/scheduleShare'
import { getHomepageStatistic } from '../lib/supabase/data'

function isMobileShareDevice(): boolean {
  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  if (typeof navigatorWithUserAgentData.userAgentData?.mobile === 'boolean') return navigatorWithUserAgentData.userAgentData.mobile
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function HomePage() {
  const { user, isDemo } = useAuth()
  const { enrollments, loading: scheduleLoading } = useSchedule()
  const [statistic, setStatistic] = useState<HomepageStatistic | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const navigate = useNavigate()
  const completion = scheduleCompletion(enrollments)
  const hasCompleteSchedule = Boolean(user) && !scheduleLoading && completion === 100
  const scheduleStatus = completion === 0
    ? { title: 'Start your schedule', description: 'Add your classes to find classmates and share schedules.', action: 'Add classes' }
    : completion < 100
      ? { title: 'Keep building your schedule', description: 'Add the remaining periods to get better classmate matches.', action: 'Continue' }
      : { title: 'Share your schedule with friends', description: 'Send a link that shows your full schedule.', action: 'Share schedule' }

  useEffect(() => {
    if (!user || !hasPendingAuthDestination()) return
    const destination = pendingAuthDestination()
    clearAuthDestination()
    void navigate(destination, { replace: true })
  }, [navigate, user])

  useEffect(() => {
    if (isDemo) return
    let active = true
    void getHomepageStatistic().then((value) => { if (active) setStatistic(value) }).catch(() => undefined)
    return () => { active = false }
  }, [isDemo])

  async function shareSchedule() {
    setSharing(true)
    setShareMessage(null)
    try {
      const url = await createScheduleShareUrl()
      if (isMobileShareDevice() && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: scheduleShareTitle, url })
          setShareMessage('Schedule shared.')
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === 'AbortError') return
          if (caught instanceof Error && caught.name === 'AbortError') return
          throw caught
        }
      } else {
        await navigator.clipboard.writeText(url)
        setShareMessage('Schedule link copied.')
      }
    } catch (caught) {
      setShareMessage(caught instanceof Error ? caught.message : 'The schedule link could not be shared.')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="home-page">
      <section className="home-hero">
        <div>
          <h1>Find out who’s in your classes.</h1>
          <p>Upload a picture of your schedule, find classmates, and share schedules with friends.</p>
          <p className="home-builder-credit">Built by the NA Computer and AI Club</p>
          <div className="hero-actions">
            {user && scheduleLoading
              ? <span className="button button-primary home-schedule-loading" aria-label="Loading schedule">Loading...</span>
              : <Link className="button button-primary" to={hasCompleteSchedule ? '/students' : '/schedule'}>{hasCompleteSchedule ? 'Find Classmates' : 'Upload My Schedule'} <ArrowRight size={18} /></Link>}
          </div>
          {statistic ? <p className="home-statistic"><strong>{new Intl.NumberFormat().format(statistic.statistic_value)}</strong> {statistic.statistic_label}</p> : null}
        </div>
      </section>
      {user && !scheduleLoading ? (
        <section className="completion-callout schedule-status-card">
          <CalendarDays aria-hidden="true" />
          <div><h2>{scheduleStatus.title}</h2><p role={shareMessage ? 'status' : undefined}>{shareMessage ?? scheduleStatus.description}</p></div>
          {hasCompleteSchedule
            ? <button className="button button-secondary completion-share-action" type="button" disabled={sharing} onClick={() => void shareSchedule()}>{sharing ? 'Sharing…' : scheduleStatus.action}</button>
            : <Link to="/schedule">{scheduleStatus.action} <ArrowRight size={17} /></Link>}
        </section>
      ) : null}
      <section className="home-links" aria-label="Major features">
        {!user ? <Link to="/schedule"><span className="home-link-icon"><CalendarDays aria-hidden="true" /></span><span className="home-link-copy"><h2>Schedule</h2><p>Create and view your schedule.</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link> : null}
        <Link to="/classes"><span className="home-link-icon"><Search aria-hidden="true" /></span><span className="home-link-copy"><h2>View Classes</h2><p>Find out who's in each class</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link>
        <Link to="/students"><span className="home-link-icon"><Users aria-hidden="true" /></span><span className="home-link-copy"><h2>Students</h2><p>Find who you share a class with</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link>
      </section>
    </div>
  )
}
