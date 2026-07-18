import { ArrowLeft, Flag, LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { GuestSchedulePrompt } from '../components/auth/GuestSchedulePrompt'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import { useNoIndex } from '../hooks/useNoIndex'
import { demoEnrollments } from '../lib/demo-data'
import type { AcademicTerm, ReportableUser, ScheduleEnrollment } from '../lib/domain'
import { getVisibleSchedule, searchReportableUsers } from '../lib/supabase/data'

export function StudentDetailPage() {
  const { studentId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isDemo } = useAuth()
  useNoIndex(!user)
  const navigationUser = (location.state as { reportedUser?: ReportableUser } | null)?.reportedUser
  const [student, setStudent] = useState<ReportableUser | null>(navigationUser ?? null)
  const [term, setTerm] = useState<AcademicTerm>('full_year')
  const [schedule, setSchedule] = useState<ScheduleEnrollment[]>([])
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    const request = isDemo ? Promise.resolve(demoEnrollments) : getVisibleSchedule(studentId)
    void request.then(setSchedule).catch(() => setDenied(true)).finally(() => setLoading(false))
  }, [isDemo, studentId, user])
  useEffect(() => {
    if (!user) return
    if (isDemo) {
      setStudent({ student_id: studentId, full_name: navigationUser?.full_name ?? 'Alex Morgan', grade: navigationUser?.grade ?? 11 })
      return
    }
    void searchReportableUsers('', studentId).then((results) => setStudent(results[0] ?? null)).catch(() => undefined)
  }, [isDemo, navigationUser?.full_name, navigationUser?.grade, studentId, user])
  if (!user) return <><section className="empty-state"><LockKeyhole size={38} /><h1>Schedule locked</h1><p>Real schedule data is never exposed to logged-out visitors.</p></section><GuestSchedulePrompt open onClose={() => void navigate('/students', { replace: true })} /></>
  if (denied) return <section className="empty-state"><LockKeyhole size={38} /><h1>This schedule isn’t available</h1><p>The student’s current privacy setting does not allow you to view it.</p><Link to="/students">Back to students</Link></section>
  return (
    <div className="student-detail-page">
      <Link className="back-link" to="/students"><ArrowLeft size={17} /> Student schedules</Link>
      <header className="page-heading"><div className="student-profile-heading" style={student ? { viewTransitionName: `student-${student.student_id}` } : undefined}>{student ? <ProfileAvatar userId={student.student_id} fullName={student.full_name} className="profile-avatar-heading" /> : null}<div><h1>{student ? `${student.full_name}’s Schedule` : 'Student Schedule'}</h1><p>Visible because this student’s privacy setting permits it.</p></div></div>{student ? <Link className="button button-secondary" to="/report" state={{ reportedUser: student }}><Flag size={17} /> Report user</Link> : null}</header>
      <TermSelector value={term} onChange={setTerm} />
      {loading ? <p className="muted">Loading schedule…</p> : <ScheduleGrid enrollments={schedule} selectedTerm={term} onAdd={() => undefined} onRemove={() => undefined} onReplace={() => undefined} onTermChange={() => undefined} readOnly />}
    </div>
  )
}
