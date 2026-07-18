import { ArrowRight, CalendarDays, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import { clearAuthDestination, hasPendingAuthDestination, pendingAuthDestination } from '../lib/authDestination'
import type { HomepageStatistic } from '../lib/domain'
import { scheduleCompletion } from '../lib/schedule'
import { getHomepageStatistic } from '../lib/supabase/data'

export function HomePage() {
  const { user, isDemo } = useAuth()
  const { enrollments } = useSchedule()
  const [statistic, setStatistic] = useState<HomepageStatistic | null>(null)
  const navigate = useNavigate()
  const completion = scheduleCompletion(enrollments)

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
          <div className="hero-actions">
            <Link className="button button-primary" to={user ? '/schedule' : '/auth?mode=sign-up&next=/schedule'}>Upload My Schedule <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" to="/students">Explore ScheduleShare</Link>
          </div>
          {statistic ? <p className="home-statistic"><strong>{new Intl.NumberFormat().format(statistic.statistic_value)}</strong> {statistic.statistic_label}</p> : null}
        </div>
      </section>
      {user && completion < 100 ? (
        <section className="completion-callout">
          <CalendarDays aria-hidden="true" />
          <div><h2>Keep building your schedule</h2><p>Add the remaining periods to get better classmate matches.</p></div>
          <Link to="/schedule">Add classes <ArrowRight size={17} /></Link>
        </section>
      ) : null}
      <section className="home-links" aria-label="Major features">
        <Link to="/schedule"><CalendarDays aria-hidden="true" /><h2>{user ? 'My Schedule' : 'Schedule Preview'}</h2><p>{user ? 'Add, replace, and review your A/B-day classes.' : 'See how an A/B-day schedule is organized before joining.'}</p><span>{user ? 'Build schedule' : 'See preview'} <ArrowRight size={16} /></span></Link>
        <Link to="/classes"><Search aria-hidden="true" /><h2>View Classes</h2><p>Search by class, teacher, day, or period.</p><span>Search classes <ArrowRight size={16} /></span></Link>
        <Link to={user ? '/classmates' : '/students'}><Users aria-hidden="true" /><h2>Classmates</h2><p>See what schedule uploading unlocks and find public student previews.</p><span>Find classmates <ArrowRight size={16} /></span></Link>
      </section>
    </div>
  )
}
