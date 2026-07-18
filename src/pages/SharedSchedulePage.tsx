import { Link2Off } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { useNoIndex } from '../hooks/useNoIndex'
import type { AcademicTerm } from '../lib/domain'
import { fetchPublicScheduleShare, publicRowsToEnrollments, type PublicScheduleShare } from '../lib/scheduleShare'

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; share: PublicScheduleShare }
  | { status: 'error' }

export function SharedSchedulePage() {
  const { token = '' } = useParams()
  const [term, setTerm] = useState<AcademicTerm>('semester_1')
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

  if (loadState.status === 'loading') return <p className="muted" role="status">Loading shared schedule…</p>
  if (loadState.status === 'error') {
    return <section className="empty-state"><Link2Off size={38} /><h1>Schedule temporarily unavailable</h1><p>ScheduleShare couldn’t load this link. Please try again in a moment.</p><Link to="/">Go to ScheduleShare</Link></section>
  }
  if (!loadState.share.available) {
    return <section className="empty-state"><Link2Off size={38} /><h1>This schedule isn’t available</h1><p>The share link may be invalid, disabled, or no longer available.</p><Link to="/">Go to ScheduleShare</Link></section>
  }

  return (
    <div className="shared-schedule-page">
      <header className="page-heading"><div><h1>Shared Schedule</h1><p>A read-only A/B-day schedule shared through ScheduleShare.</p></div></header>
      <TermSelector value={term} onChange={setTerm} />
      <div className="schedule-layout">
        <ScheduleGrid
          enrollments={enrollments}
          selectedTerm={term}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onReplace={() => undefined}
          onTermChange={() => undefined}
          readOnly
        />
      </div>
    </div>
  )
}
