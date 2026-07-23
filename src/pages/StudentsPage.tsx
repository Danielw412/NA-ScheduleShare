import { ChevronRight, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import type { ClassmateResult, StudentDirectoryResult } from '../lib/domain'
import {
  allowScheduleAccess,
  cancelScheduleAccessRequest,
  getClassmates,
  removeScheduleAccess,
  requestScheduleAccess,
  scheduleAccessChangedEvent,
  searchStudentDirectory,
} from '../lib/supabase/data'

const demoClassmates: ClassmateResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'classmates', shared_course_names: ['AP Language', 'Academic Chemistry', 'Honors Algebra 2'], can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'school', shared_course_names: ['Academic Chemistry'], can_view_schedule: true },
]

const demoStudents: StudentDirectoryResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 3, can_view_schedule: true, they_can_view_yours: 'shared_class', you_can_view_theirs: 'everyone_allowed', outgoing_request_pending: false },
  { student_id: '40000000-0000-4000-8000-000000000002', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'classmates', shared_class_count: 1, can_view_schedule: true, they_can_view_yours: 'approved_by_you', you_can_view_theirs: 'shared_class', outgoing_request_pending: false },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Casey', grade: 12, privacy_setting: 'private', shared_class_count: 0, can_view_schedule: false, they_can_view_yours: 'no_access', you_can_view_theirs: 'private', outgoing_request_pending: false },
]

const accessLabels: Record<StudentDirectoryResult['they_can_view_yours'] | StudentDirectoryResult['you_can_view_theirs'], string> = {
  shared_class: 'Shared class',
  everyone_allowed: 'Everyone allowed',
  approved_by_you: 'Approved by you',
  approved_by_them: 'Approved by them',
  no_access: 'No access',
  private: 'Private',
  admin: 'Admin access',
}

type StudentAction = 'allow' | 'remove' | 'request' | 'cancel'
type StudentsView = 'classmates' | 'all'

export function StudentsPage() {
  const { markStudentsVisited } = useAuth()

  useEffect(() => {
    void markStudentsVisited().catch(() => undefined)
  }, [markStudentsVisited])

  return <DiscoveryGate><StudentBrowser /></DiscoveryGate>
}

function StudentBrowser() {
  const [view, setView] = useState<StudentsView>('classmates')

  return (
    <div className="students-page">
      <header className="page-heading"><div><h1>Students</h1><p>Find classmates or browse all student schedules</p></div></header>
      <div className="students-segmented-control" role="group" aria-label="Student list">
        <button className={view === 'classmates' ? 'is-active' : ''} type="button" aria-pressed={view === 'classmates'} onClick={() => setView('classmates')}>Classmates</button>
        <button className={view === 'all' ? 'is-active' : ''} type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>All students</button>
      </div>
      {view === 'classmates' ? <ClassmatesList /> : <StudentDirectory />}
    </div>
  )
}

function ClassmatesList() {
  const { isDemo } = useAuth()
  const [classmates, setClassmates] = useState<ClassmateResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const request = isDemo ? Promise.resolve(demoClassmates) : getClassmates()
    void request.then(setClassmates).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load classmates.')).finally(() => setLoading(false))
  }, [isDemo])

  return <section className="students-view-panel" aria-label="Classmates">
    {loading ? <p className="muted">Loading classmates…</p> : null}
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
    {!loading && !error && classmates.length === 0 ? <section className="empty-state"><Users size={36} /><h2>No shared classmates found yet.</h2><p>Finish your schedule or check back as more students join.</p><Link to="/schedule">Finish my schedule</Link></section> : null}
    <div className="classmate-list">{classmates.map((classmate) => <article key={classmate.student_id} style={{ viewTransitionName: `student-${classmate.student_id}` }}><ProfileAvatar userId={classmate.student_id} fullName={classmate.full_name} /><div className="classmate-copy"><h2>{classmate.full_name}</h2><p>Grade {classmate.grade}</p></div><div className="shared-class-list">{classmate.shared_course_names.map((name) => <span className="shared-class" key={name}>{name}</span>)}</div>{classmate.can_view_schedule ? <Link viewTransition className="button button-secondary" to={`/students/${classmate.student_id}`}>View schedule</Link> : <span className="private-label"><Users size={16} /> Shared classes only</span>}</article>)}</div>
  </section>
}

function StudentDirectory() {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [courseName, setCourseName] = useState('')
  const [teacherLastName, setTeacherLastName] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [students, setStudents] = useState<StudentDirectoryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [acting, setActing] = useState<{ studentId: string; action: StudentAction } | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const activeFilterCount = Number(Boolean(grade)) + Number(Boolean(courseName.trim())) + Number(Boolean(teacherLastName.trim()))

  useEffect(() => {
    const refreshAccess = () => setRefreshVersion((current) => current + 1)
    window.addEventListener(scheduleAccessChangedEvent, refreshAccess)
    return () => window.removeEventListener(scheduleAccessChangedEvent, refreshAccess)
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      const request = isDemo
        ? Promise.resolve(demoStudents.filter((student) => (!query || student.full_name.toLowerCase().includes(query.toLowerCase())) && (!grade || student.grade === grade)))
        : searchStudentDirectory({ query, grade: grade || undefined, courseName, teacherLastName })
      void request
        .then((results) => { if (active) setStudents(results) })
        .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Directory search failed.') })
        .finally(() => { if (active) setLoading(false) })
    }, refreshVersion > 0 ? 0 : 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [courseName, grade, isDemo, query, refreshVersion, teacherLastName])

  function clearFilters() {
    setGrade('')
    setCourseName('')
    setTeacherLastName('')
  }

  function applyOptimisticAction(studentId: string, action: StudentAction) {
    setStudents((current) => current.map((student) => {
      if (student.student_id !== studentId) return student
      if (action === 'allow') return { ...student, they_can_view_yours: 'approved_by_you' }
      if (action === 'remove') return { ...student, they_can_view_yours: 'no_access' }
      if (action === 'request') return { ...student, outgoing_request_pending: true }
      return { ...student, outgoing_request_pending: false }
    }))
  }

  async function performAction(student: StudentDirectoryResult, action: StudentAction) {
    setActing({ studentId: student.student_id, action })
    setError(null)
    setSuccess(null)
    try {
      if (!isDemo) {
        if (action === 'allow') await allowScheduleAccess(student.student_id)
        if (action === 'remove') await removeScheduleAccess(student.student_id)
        if (action === 'request') await requestScheduleAccess(student.student_id)
        if (action === 'cancel') await cancelScheduleAccessRequest(student.student_id)
      }
      applyOptimisticAction(student.student_id, action)
      setSuccess(action === 'allow'
        ? `${student.full_name} can now view your schedule.`
        : action === 'remove'
          ? `Schedule access removed for ${student.full_name}.`
          : action === 'request'
            ? `Access requested from ${student.full_name}.`
            : 'Access request canceled.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Schedule access could not be updated.')
    } finally {
      setActing(null)
    }
  }

  return <section className="students-view-panel" aria-label="All students">
    <section className="directory-filters">
      <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Student name</span><input placeholder="Student name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button aria-controls="student-mobile-filter-panel" aria-expanded={filtersOpen} className="mobile-filter-toggle" type="button" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={18} aria-hidden="true" /> Filters{activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}</button>
      <div className={filtersOpen ? 'mobile-filter-panel directory-filter-panel is-open' : 'mobile-filter-panel directory-filter-panel'} id="student-mobile-filter-panel">
        <label><span>Grade</span><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Course</span><input placeholder="Any course" value={courseName} onChange={(event) => setCourseName(event.target.value)} /></label>
        <label><span>Teacher Last Name</span><input placeholder="Any teacher last name" value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} /></label>
      </div>
    </section>
    {activeFilterCount > 0 ? <div className="mobile-active-filters" aria-label="Active student filters">
      {grade ? <button type="button" onClick={() => setGrade('')}>Grade {grade} <X size={14} aria-hidden="true" /></button> : null}
      {courseName.trim() ? <button type="button" onClick={() => setCourseName('')}>{courseName.trim()} <X size={14} aria-hidden="true" /></button> : null}
      {teacherLastName.trim() ? <button type="button" onClick={() => setTeacherLastName('')}>{teacherLastName.trim()} <X size={14} aria-hidden="true" /></button> : null}
      <button className="clear-filter-button" type="button" onClick={clearFilters}>Clear filters</button>
    </div> : null}
    {success ? <div className="toast-message" role="status"><span>{success}</span><button type="button" aria-label="Dismiss message" onClick={() => setSuccess(null)}>×</button></div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="student-results" aria-label="Student schedules">
      {loading ? <p className="muted">Loading schedules…</p> : students.map((student) => {
        const isActing = acting?.studentId === student.student_id
        const actionLabel = acting?.action === 'allow' ? 'Allowing…' : acting?.action === 'remove' ? 'Removing…' : acting?.action === 'request' ? 'Requesting…' : 'Canceling…'
        const profile = <><ProfileAvatar userId={student.student_id} fullName={student.full_name} /><span className="student-access-name"><strong>{student.full_name}</strong><small>Grade {student.grade}{student.shared_class_count > 0 ? ` · ${student.shared_class_count} shared ${student.shared_class_count === 1 ? 'class' : 'classes'}` : ''}</small></span></>
        return <article className="student-access-card" key={student.student_id} style={{ viewTransitionName: `student-${student.student_id}` }}>
          {student.can_view_schedule
            ? <Link className="student-access-profile" viewTransition to={`/students/${student.student_id}`} state={{ reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade } }}>{profile}</Link>
            : <div className="student-access-profile">{profile}</div>}
          <div className="student-access-statuses">
            <span><small>Access to your schedule</small><strong data-access={student.they_can_view_yours}>{accessLabels[student.they_can_view_yours]}</strong></span>
            <span><small>Access to their schedule</small><strong data-access={student.you_can_view_theirs}>{accessLabels[student.you_can_view_theirs]}</strong></span>
          </div>
          <div className="student-access-actions">
            {student.they_can_view_yours === 'no_access' ? <button className="button button-secondary" type="button" disabled={acting !== null} onClick={() => void performAction(student, 'allow')}>{isActing ? actionLabel : 'Allow access'}</button> : null}
            {student.they_can_view_yours === 'approved_by_you' ? <button className="button button-secondary" type="button" disabled={acting !== null} onClick={() => void performAction(student, 'remove')}>{isActing ? actionLabel : 'Remove access'}</button> : null}
            {student.you_can_view_theirs === 'private' && !student.outgoing_request_pending ? <button className="button button-primary" type="button" disabled={acting !== null} onClick={() => void performAction(student, 'request')}>{isActing ? actionLabel : 'Request access'}</button> : null}
            {student.you_can_view_theirs === 'private' && student.outgoing_request_pending ? <><span className="access-requested">Access requested</span><button className="access-cancel-button" type="button" disabled={acting !== null} onClick={() => void performAction(student, 'cancel')}>{isActing ? actionLabel : 'Cancel request'}</button></> : null}
            {student.can_view_schedule ? <Link className="student-view-schedule" viewTransition to={`/students/${student.student_id}`} state={{ reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade } }}>View schedule <ChevronRight size={17} aria-hidden="true" /></Link> : null}
          </div>
        </article>
      })}
      {!loading && students.length === 0 ? <p className="empty-inline">No students match those filters.</p> : null}
    </div>
  </section>
}
