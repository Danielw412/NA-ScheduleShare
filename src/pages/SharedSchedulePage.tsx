import { ImagePlus, Link2Off, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchoolDayDefaults } from '../features/students/useSchoolDayDefaults'
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
  const schoolDay = useSchoolDayDefaults()
  const [pickedTerm, setPickedTerm] = useState<SemesterTerm | null>(null)
  const term: SemesterTerm = pickedTerm ?? schoolDay.semester ?? 'semester_1'
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
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
  }, [attempt, token])

  const rows = loadState.status === 'loaded' ? loadState.share.schedule : []
  const enrollments = useMemo(() => publicRowsToEnrollments(rows), [rows])
  const showScheduleUpload = !user || (!schedule.loading && scheduleCompletion(schedule.enrollments) < 100)

  if (loadState.status === 'loading') return <LoadingScreen label="Loading shared schedule…" />

  // Both failure states stay generic: they never say whose link it was or why it stopped working.
  if (loadState.status === 'error') {
    return (
      <SharedUnavailable
        title="Schedule temporarily unavailable"
        actions={<>
          <button className="button button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw aria-hidden="true" />Try again</button>
          <Link className="button button-ghost" to="/">Go to ScheduleShare</Link>
        </>}
      >ScheduleShare couldn’t load this link. Please try again in a moment.</SharedUnavailable>
    )
  }
  if (!loadState.share.available) {
    return (
      <SharedUnavailable title="This schedule isn’t available" actions={<Link className="button button-secondary" to="/">Go to ScheduleShare</Link>}>
        The share link may be invalid, disabled, or no longer available.
      </SharedUnavailable>
    )
  }

  const owner = loadState.share.owner_name

  return (
    <div className="page students-shared-page">
      <PageHeader
        title={owner ? `${owner}’s schedule` : 'Shared schedule'}
        description="Shared through NA ScheduleShare."
        actions={showScheduleUpload ? <Link className="button button-secondary" to="/schedule?import=1"><ImagePlus aria-hidden="true" />Upload your own schedule</Link> : null}
      />
      <section className="section students-shared-schedule" aria-label={owner ? `${owner}’s classes` : 'Shared classes'}>
        <div className="section-header">
          <TermSelector value={term} onChange={setPickedTerm} />
        </div>
        <ScheduleGrid
          enrollments={enrollments}
          selectedTerm={term}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onReplace={() => undefined}
          readOnly
          defaultMobileDay={schoolDay.dayType}
          todayDayType={schoolDay.todaySemester === term ? schoolDay.todayDayType : null}
        />
      </section>
      {showScheduleUpload ? (
        <section className="students-shared-invite" aria-labelledby="students-shared-invite-title">
          <div>
            <h2 id="students-shared-invite-title">Make your own schedule</h2>
            <p>Upload a screenshot of your schedule to find classmates and share it with friends.</p>
          </div>
          <Link className="button button-primary" to="/schedule?import=1"><ImagePlus aria-hidden="true" />Upload my schedule</Link>
        </section>
      ) : null}
    </div>
  )
}

function SharedUnavailable({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="page students-shared-page is-unavailable">
      <div className="empty-state is-centered students-shared-empty">
        <span className="empty-state-icon"><Link2Off aria-hidden="true" /></span>
        <h1>{title}</h1>
        <p>{children}</p>
        <div className="form-actions">{actions}</div>
      </div>
    </div>
  )
}
