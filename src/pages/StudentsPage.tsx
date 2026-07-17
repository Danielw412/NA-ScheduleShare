import { LockKeyhole, Search, SlidersHorizontal, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { GuestSchedulePrompt } from '../components/auth/GuestSchedulePrompt'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import { useNoIndex } from '../hooks/useNoIndex'
import type { GuestStudentResult, StudentDirectoryResult } from '../lib/domain'
import { searchGuestStudents, searchStudentDirectory } from '../lib/supabase/data'

const demoStudents: StudentDirectoryResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 3, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000002', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'classmates', shared_class_count: 1, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Casey Park', grade: 12, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true },
]

export function StudentsPage() {
  const { user } = useAuth()
  useNoIndex(!user)
  return user ? <DiscoveryGate><AuthenticatedStudentDirectory /></DiscoveryGate> : <GuestStudentDirectory />
}

function GuestStudentDirectory() {
  const [query, setQuery] = useState('')
  const [students, setStudents] = useState<GuestStudentResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length < 2) {
      setStudents([])
      setLoading(false)
      setError(null)
      return
    }
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void searchGuestStudents(normalized)
        .then(setStudents)
        .catch(() => setError('Public student search is temporarily unavailable. Please try again.'))
        .finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  return (
    <div className="students-page guest-students-page">
      <header className="page-heading"><div><span className="eyebrow">Guest exploration</span><h1>Find NA students</h1><p>Search by first name. Guests only see students who chose “Anyone,” and names remain limited to a first name and last initial.</p></div></header>
      <section className="guest-unlock-card">
        <LockKeyhole aria-hidden="true" />
        <div><h2>Create an account and add your schedule to discover classmates.</h2><p>Uploading unlocks privacy-aware classmate matching, schedule comparison, and class discovery.</p></div>
        <Link className="button button-primary" to="/auth?mode=sign-up&next=/schedule">Create Account</Link>
      </section>
      <label className="search-input guest-student-search"><Search aria-hidden="true" /><span className="sr-only">First name</span><input autoComplete="off" placeholder="Search first name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="guest-search-help">Enter a student’s full first name. Results are capped and cannot be downloaded as a student directory.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <p className="muted">Searching public profiles…</p> : null}
      <div className="guest-student-grid" aria-live="polite">
        {students.map((student, index) => <article className="guest-student-card" key={`${student.first_name}-${student.last_initial}-${index}`}>
          <span className="guest-avatar" aria-hidden="true"><UserRound /></span>
          <div><h2>{student.display_name}</h2><p>Public preview · Schedule details hidden</p></div>
          <button className="button button-secondary" type="button" onClick={() => setPromptOpen(true)}>View Schedule</button>
        </article>)}
      </div>
      {!loading && query.trim().length >= 2 && students.length === 0 && !error ? <p className="empty-inline">No public student previews match that first name.</p> : null}
      <section className="guest-feature-preview"><h2>What uploading unlocks</h2><div><span>Find people who share a class</span><span>Compare allowed schedules</span><span>Review classes before saving</span></div></section>
      <GuestSchedulePrompt open={promptOpen} onClose={() => setPromptOpen(false)} />
    </div>
  )
}

function AuthenticatedStudentDirectory() {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [courseName, setCourseName] = useState('')
  const [teacherLastName, setTeacherLastName] = useState('')
  const [students, setStudents] = useState<StudentDirectoryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      const request = isDemo
        ? Promise.resolve(demoStudents.filter((student) => (!query || student.full_name.toLowerCase().includes(query.toLowerCase())) && (!grade || student.grade === grade)))
        : searchStudentDirectory({ query, grade: grade || undefined, courseName, teacherLastName })
      void request.then(setStudents).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Directory search failed.')).finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [courseName, grade, isDemo, query, teacherLastName])

  return (
    <div className="students-page">
      <header className="page-heading"><div><h1>Student Schedules</h1><p>Only students whose privacy setting permits discovery appear here.</p></div></header>
      <section className="directory-filters">
        <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Student name</span><input placeholder="Student name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label><span>Grade</span><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Course</span><input placeholder="Any course" value={courseName} onChange={(event) => setCourseName(event.target.value)} /></label>
        <label><span>Teacher Last Name</span><input placeholder="Any teacher last name" value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} /></label>
        <SlidersHorizontal aria-hidden="true" />
      </section>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="directory-table" role="table" aria-label="Student schedules">
        <div className="directory-header" role="row"><span>Student</span><span>Grade</span><span>Shared classes</span><span>Privacy</span><span /></div>
        {loading ? <p className="muted">Loading schedules…</p> : students.map((student) => <div className="directory-row" role="row" key={student.student_id} style={{ viewTransitionName: `student-${student.student_id}` }}><span><ProfileAvatar userId={student.student_id} fullName={student.full_name} /><strong>{student.full_name}</strong></span><span>{student.grade}</span><span>{student.shared_class_count}</span><span className="privacy-value">{student.privacy_setting === 'school' ? 'Anyone' : 'Classmates'}</span><span>{student.can_view_schedule ? <Link viewTransition to={`/students/${student.student_id}`} state={{ reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade } }}>View schedule</Link> : 'Unavailable'}</span></div>)}
        {!loading && students.length === 0 ? <p className="empty-inline">No viewable schedules match those filters.</p> : null}
      </div>
    </div>
  )
}
