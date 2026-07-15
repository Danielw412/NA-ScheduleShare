import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { useAuth } from '../features/auth/AuthProvider'
import { demoEnrollments } from '../lib/demo-data'
import type { AcademicTerm, ScheduleEnrollment } from '../lib/domain'
import { getVisibleSchedule } from '../lib/supabase/data'

export function StudentDetailPage() {
  const { studentId = '' } = useParams()
  const { isDemo } = useAuth()
  const [term, setTerm] = useState<AcademicTerm>('full_year')
  const [schedule, setSchedule] = useState<ScheduleEnrollment[]>([])
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const request = isDemo ? Promise.resolve(demoEnrollments) : getVisibleSchedule(studentId)
    void request.then(setSchedule).catch(() => setDenied(true)).finally(() => setLoading(false))
  }, [isDemo, studentId])
  if (denied) return <section className="empty-state"><LockKeyhole size={38} /><h1>This schedule is private</h1><p>You may still see shared class membership on a class page.</p><Link to="/students">Back to students</Link></section>
  return (
    <div className="student-detail-page">
      <Link className="back-link" to="/students"><ArrowLeft size={17} /> Student schedules</Link>
      <header className="page-heading"><div><h1>{isDemo ? 'Alex Morgan’s Schedule' : 'Student Schedule'}</h1><p>Visible because this student’s privacy setting permits it.</p></div></header>
      <TermSelector value={term} onChange={setTerm} />
      {loading ? <p className="muted">Loading schedule…</p> : <ScheduleGrid enrollments={schedule} selectedTerm={term} onAdd={() => undefined} onRemove={() => undefined} onReplace={() => undefined} onTermChange={() => undefined} readOnly />}
    </div>
  )
}
