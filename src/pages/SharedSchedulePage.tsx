import { ImagePlus, Link2Off } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import { useNoIndex } from '../hooks/useNoIndex'
import type { SemesterTerm } from '../lib/domain'
import { scheduleCompletion } from '../lib/schedule'
import { fetchPublicScheduleShare, publicRowsToEnrollments, type PublicScheduleShare } from '../lib/scheduleShare'

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; share: PublicScheduleShare }
  | { status: 'error' }

export function SharedSchedulePage() {
  const { token = '' } = useParams()
  const { user } = useAuth()
  const schedule = useSchedule()
  const [term, setTerm] = useState<SemesterTerm>('semester_1')
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  useNoIndex(true)

  useEffect(() => {
    let active = true
    setLoadState({ status: 'loading' })
    void fetchPublicScheduleShare(token)
      .then((share) => {
        if (active) setLoadState({ status: 'loaded', share })
      })
      .catch(() => {
        if (active) setLoadState({ status: 'error' })
      })
    return () => { active = false }
  }, [token])

  const rows = loadState.status === 'loaded' ? loadState.share.schedule : []
  const enrollments = useMemo(() => publicRowsToEnrollments(rows), [rows])
  const showScheduleUpload = !user || (!schedule.loading && scheduleCompletion(schedule.enrollments) < 100)

  if (loadState.status === 'loading') return <p className="muted" role="status">Loading shared schedule…</p>
  if (loadState.status === 'error') {
    return <section className="empty-state"><Link2Off size={38} /><h1>Schedule temporarily unavailable</h1><p>ScheduleShare couldn’t load this link. Please try again in a moment.</p><Link to="/">Go to ScheduleShare</Link></section>
  }
  if (!loadState.share.available) {
    return <section className="empty-state"><Link2Off size={38} /><h1>This schedule isn’t available</h1><p>The share link may be invalid, disabled, or no longer available.</p><Link to="/">Go to ScheduleShare</Link></section>
  }

  return (
    <div className="shared-schedule-page">
      <header className="page-heading"><div><h1>{loadState.share.owner_name ? `${loadState.share.owner_name}'s schedule` : 'Shared Schedule'}</h1></div></header>
      <TermSelector value={term} onChange={setTerm} />
      {showScheduleUpload ? <Link className="button button-import shared-schedule-top-upload" to="/schedule?import=1"><ImagePlus size={18} aria-hidden="true" /> Upload your own schedule</Link> : null}
      <div className="schedule-layout">
        <ScheduleGrid
          enrollments={enrollments}
          selectedTerm={term}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onReplace={() => undefined}
          readOnly
        />
      </div>
      {showScheduleUpload ? <section className="shared-schedule-upload">
        <ImagePlus size={30} aria-hidden="true" />
        <div><h2>Build your own schedule</h2><p>Upload your schedule to find classmates and share it with friends.</p></div>
        <Link className="button button-import" to="/schedule?import=1"><ImagePlus size={18} aria-hidden="true" /> Upload My Schedule</Link>
      </section> : null}
    </div>
  )
}
