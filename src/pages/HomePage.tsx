import { ArrowRight, CalendarDays, Search, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import { scheduleCompletion } from '../lib/schedule'

export function HomePage() {
  const { profile } = useAuth()
  const { enrollments, loading } = useSchedule()
  const completion = scheduleCompletion(enrollments)
  return (
    <div className="home-page">
      <section className="home-hero">
        <div>
          <h1>Hey {profile?.full_name.split(' ')[0]}, who’s in your classes?</h1>
          <p>Build your schedule, find classmates, and compare schedules with friends.</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/schedule">Open my schedule <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" to="/classes">Find a class</Link>
          </div>
        </div>
        <div className="hero-schedule-preview" aria-label="Schedule summary">
          <span>{loading ? '…' : `${completion}%`}</span>
          <div><strong>Schedule progress</strong><small>{enrollments.length} classes added</small></div>
          <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
        </div>
      </section>
      {completion < 100 ? (
        <section className="completion-callout">
          <CalendarDays aria-hidden="true" />
          <div><h2>Keep building your schedule</h2><p>Add the remaining periods to get better classmate matches.</p></div>
          <Link to="/schedule">Add classes <ArrowRight size={17} /></Link>
        </section>
      ) : null}
      <section className="home-links" aria-label="Major features">
        <Link to="/schedule"><CalendarDays aria-hidden="true" /><h2>My Schedule</h2><p>Add, replace, and review your A/B-day classes.</p><span>Build schedule <ArrowRight size={16} /></span></Link>
        <Link to="/classes"><Search aria-hidden="true" /><h2>View Classes</h2><p>Search by class, teacher, day, or period.</p><span>Search classes <ArrowRight size={16} /></span></Link>
        <Link to="/classmates"><Users aria-hidden="true" /><h2>Classmates</h2><p>See people who share at least one class with you.</p><span>Find classmates <ArrowRight size={16} /></span></Link>
      </section>
    </div>
  )
}
