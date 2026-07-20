import { ArrowRight, CalendarDays, ChevronRight, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import { clearAuthDestination, hasPendingAuthDestination, pendingAuthDestination } from '../lib/authDestination'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import type { HomepageStatistic } from '../lib/domain'
import { scheduleCompletion } from '../lib/schedule'
import { getHomepageStatistic } from '../lib/supabase/data'

export function HomePage() {
  const { user, isDemo } = useAuth()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const { enrollments } = useSchedule()
  const [statistic, setStatistic] = useState<HomepageStatistic | null>(null)
  const navigate = useNavigate()
  const completion = scheduleCompletion(enrollments)
  const scheduleStatus = completion === 0
    ? { title: 'Start your schedule', description: 'Add your classes to find classmates and compare schedules.', action: 'Add classes' }
    : completion < 100
      ? { title: 'Keep building your schedule', description: 'Add the remaining periods to get better classmate matches.', action: 'Continue' }
      : { title: 'Your schedule is ready', description: 'View or update your classes at any time.', action: 'View schedule' }

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

  return (
    <div className="home-page">
      <section className="home-hero">
        <div>
          <h1>Find out who’s in your classes.</h1>
          <p>Upload a picture of your schedule, find classmates, and compare schedules with friends.</p>
          <p className="home-builder-credit">Built by the NA Computer and AI Club</p>
          <div className="hero-actions">
            {user ? <Link className="button button-primary" to="/schedule">Upload My Schedule <ArrowRight size={18} /></Link> : <button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Upload My Schedule <ArrowRight size={18} /></button>}
          </div>
          {statistic ? <p className="home-statistic"><strong>{new Intl.NumberFormat().format(statistic.statistic_value)}</strong> {statistic.statistic_label}</p> : null}
        </div>
      </section>
      {user ? (
        <section className="completion-callout schedule-status-card">
          <CalendarDays aria-hidden="true" />
          <div><h2>{scheduleStatus.title}</h2><p>{scheduleStatus.description}</p></div>
          <Link to="/schedule">{scheduleStatus.action} <ArrowRight size={17} /></Link>
        </section>
      ) : null}
      <section className="home-links" aria-label="Major features">
        {!user ? <Link to="/schedule"><span className="home-link-icon"><CalendarDays aria-hidden="true" /></span><span className="home-link-copy"><h2>Schedule</h2><p>Create and view your schedule.</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link> : null}
        <Link to="/classes"><span className="home-link-icon"><Search aria-hidden="true" /></span><span className="home-link-copy"><h2>View Classes</h2><p>Find out who's in each class</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link>
        <Link to={user ? '/classmates' : '/students'}><span className="home-link-icon"><Users aria-hidden="true" /></span><span className="home-link-copy"><h2>Classmates</h2><p>Find who you share a class with</p></span><ChevronRight className="home-link-arrow" aria-hidden="true" /></Link>
      </section>
    </div>
  )
}
