import { AlertCircle, ChevronRight, Eye, LockKeyhole, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import type { ClassmateResult, ReportableUser, StudentDirectoryResult } from '../lib/domain'
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

type AccessValue = StudentDirectoryResult['they_can_view_yours'] | StudentDirectoryResult['you_can_view_theirs']

const accessLabels: Record<AccessValue, string> = {
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

/**
 * Router state for links to a student's page: who they are (for the header
 * and the report form) and, from the All students list, why their schedule
 * is visible.
 */
export interface StudentNavigationState {
  reportedUser: ReportableUser
  access?: StudentDirectoryResult['you_can_view_theirs']
}

function hasAccess(value: AccessValue): boolean {
  return value !== 'no_access' && value !== 'private'
}

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
    <div className="page students-page">
      <PageHeader title="Students" description="Find classmates and see the schedules other students share with you." />
      <div className="students-browser">
        <SegmentedControl
          className="students-switch"
          label="Student list"
          value={view}
          onChange={setView}
          options={[{ value: 'classmates', label: 'Classmates' }, { value: 'all', label: 'All students' }]}
        />
        {view === 'classmates' ? <ClassmatesList /> : <StudentDirectory />}
      </div>
    </div>
  )
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div className="students-loading" role="status">
      <span className="sr-only">{label}</span>
      {[0, 1, 2, 3].map((index) => (
        <span className="students-loading-row" aria-hidden="true" key={index}>
          <span className="skeleton students-loading-avatar" />
          <span className="skeleton students-loading-text" />
        </span>
      ))}
    </div>
  )
}

function ClassmatesList() {
  const { isDemo } = useAuth()
  const [classmates, setClassmates] = useState<ClassmateResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setClassmates([])
    setLoading(true)
    setError('')
    const request = isDemo ? Promise.resolve(demoClassmates) : getClassmates()
    void request
      .then((nextClassmates) => { if (active) setClassmates(nextClassmates) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load classmates.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt, isDemo])

  return (
    <section className="students-view" aria-label="Classmates">
      {loading ? <ListSkeleton label="Loading classmates…" /> : null}
      {error ? (
        <div className="notice notice-danger" role="alert">
          <AlertCircle aria-hidden="true" />
          <div><strong>Classmates didn’t load.</strong> {error}</div>
          <button className="button button-secondary button-sm" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </div>
      ) : null}
      {!loading && !error && classmates.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No shared classmates found yet."
          action={<Link className="button button-primary" to="/schedule">Finish my schedule</Link>}
        >Finish your schedule or check back as more students join.</EmptyState>
      ) : null}
      {!loading && classmates.length > 0 ? <>
        <p className="students-summary">{classmates.length === 1 ? '1 student shares' : `${classmates.length} students share`} at least one class with you.</p>
        <ul className="list students-list">
          {classmates.map((classmate) => (
            <li className="students-row" key={classmate.student_id} style={{ viewTransitionName: `student-${classmate.student_id}` }}>
              <ProfileAvatar userId={classmate.student_id} fullName={classmate.full_name} />
              <div className="students-identity-text">
                <strong>{classmate.full_name}</strong>
                <span>Grade {classmate.grade}</span>
              </div>
              {classmate.shared_course_names.length > 0 ? (
                <ul className="chip-list students-row-classes" aria-label={`Classes you share with ${classmate.full_name}`}>
                  {classmate.shared_course_names.map((name) => <li className="chip" key={name}>{name}</li>)}
                </ul>
              ) : null}
              <div className="students-row-actions">
                {classmate.can_view_schedule
                  ? <Link
                    viewTransition
                    className="button button-secondary"
                    to={`/students/${classmate.student_id}`}
                    state={{ reportedUser: { student_id: classmate.student_id, full_name: classmate.full_name, grade: classmate.grade } } satisfies StudentNavigationState}
                  >View schedule</Link>
                  : <span className="students-private"><LockKeyhole aria-hidden="true" />Shared classes only</span>}
              </div>
            </li>
          ))}
        </ul>
      </> : null}
    </section>
  )
}

function StudentDirectory() {
  const { isDemo } = useAuth()
  const { showToast } = useToast()
  const panelId = useId()
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [courseName, setCourseName] = useState('')
  const [teacherLastName, setTeacherLastName] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [students, setStudents] = useState<StudentDirectoryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ studentId: string; message: string } | null>(null)
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
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
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
    setActionError(null)
    try {
      if (!isDemo) {
        if (action === 'allow') await allowScheduleAccess(student.student_id)
        if (action === 'remove') await removeScheduleAccess(student.student_id)
        if (action === 'request') await requestScheduleAccess(student.student_id)
        if (action === 'cancel') await cancelScheduleAccessRequest(student.student_id)
      }
      applyOptimisticAction(student.student_id, action)
      showToast(action === 'allow'
        ? `${student.full_name} can now view your schedule.`
        : action === 'remove'
          ? `Schedule access removed for ${student.full_name}.`
          : action === 'request'
            ? `Access requested from ${student.full_name}.`
            : 'Access request canceled.')
    } catch (caught) {
      setActionError({ studentId: student.student_id, message: caught instanceof Error ? caught.message : 'Schedule access could not be updated.' })
    } finally {
      setActing(null)
    }
  }

  const filtered = Boolean(query.trim()) || activeFilterCount > 0

  return (
    <section className="students-view" aria-label="All students">
      <div className="students-search" role="search" aria-label="Find a student">
        <label className="search-input">
          <Search aria-hidden="true" />
          <span className="sr-only">Student name</span>
          <input type="search" placeholder="Student name" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button
          aria-controls={panelId}
          aria-expanded={filtersOpen}
          className={filtersOpen ? 'button button-secondary students-filter-toggle is-open' : 'button button-secondary students-filter-toggle'}
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" />Filters
          {activeFilterCount > 0 ? <span className="students-filter-count"><span className="sr-only">, </span>{activeFilterCount}<span className="sr-only"> active</span></span> : null}
        </button>
      </div>
      <div className="students-filter-panel" id={panelId} hidden={!filtersOpen}>
        <div className="field">
          <label htmlFor={`${panelId}-grade`}>Grade</label>
          <select id={`${panelId}-grade`} value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}>
            <option value="">All grades</option>
            {[9, 10, 11, 12].map((value) => <option key={value} value={value}>Grade {value}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${panelId}-course`}>Course</label>
          <input id={`${panelId}-course`} placeholder="Any course" value={courseName} onChange={(event) => setCourseName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${panelId}-teacher`}>Teacher last name</label>
          <input id={`${panelId}-teacher`} placeholder="Any teacher" value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} />
        </div>
      </div>
      {activeFilterCount > 0 ? (
        <div className="students-active-filters" aria-label="Active student filters">
          {grade ? <button className="students-filter-chip" type="button" onClick={() => setGrade('')}>Grade {grade}<X aria-hidden="true" /><span className="sr-only">Remove filter</span></button> : null}
          {courseName.trim() ? <button className="students-filter-chip" type="button" onClick={() => setCourseName('')}>{courseName.trim()}<X aria-hidden="true" /><span className="sr-only">Remove filter</span></button> : null}
          {teacherLastName.trim() ? <button className="students-filter-chip" type="button" onClick={() => setTeacherLastName('')}>{teacherLastName.trim()}<X aria-hidden="true" /><span className="sr-only">Remove filter</span></button> : null}
          <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : null}
      {error ? <div className="notice notice-danger" role="alert"><AlertCircle aria-hidden="true" /><div><strong>Search didn’t work.</strong> {error}</div></div> : null}
      <div className="students-results" aria-label="Student schedules">
        {loading ? <ListSkeleton label="Loading schedules…" /> : <>
          {students.length > 0 ? <p className="students-summary">{students.length === 1 ? '1 student' : `${students.length} students`}</p> : null}
          <ul className="list students-list">
            {students.map((student) => (
              <DirectoryRow
                key={student.student_id}
                student={student}
                acting={acting}
                error={actionError?.studentId === student.student_id ? actionError.message : null}
                onAction={(action) => void performAction(student, action)}
              />
            ))}
          </ul>
        </>}
        {!loading && !error && students.length === 0 ? (
          <div className="students-no-results">
            <p>{filtered ? 'No students match those filters.' : 'No students to show yet.'}</p>
            {activeFilterCount > 0 ? <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

interface DirectoryRowProps {
  student: StudentDirectoryResult
  acting: { studentId: string; action: StudentAction } | null
  error: string | null
  onAction: (action: StudentAction) => void
}

function AccessFact({ label, value }: { label: string; value: AccessValue }) {
  const granted = hasAccess(value)
  const Icon = granted ? Eye : LockKeyhole
  return (
    <div className="students-access-fact">
      <dt>{label}</dt>
      <dd className={granted ? 'is-granted' : undefined} data-access={value}><Icon aria-hidden="true" />{accessLabels[value]}</dd>
    </div>
  )
}

function DirectoryRow({ student, acting, error, onAction }: DirectoryRowProps) {
  const isActing = acting?.studentId === student.student_id
  const busy = acting !== null
  const actionLabel = acting?.action === 'allow' ? 'Allowing…' : acting?.action === 'remove' ? 'Removing…' : acting?.action === 'request' ? 'Requesting…' : 'Canceling…'
  const navigationState: StudentNavigationState = {
    reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade },
    access: student.you_can_view_theirs,
  }
  const identity = <>
    <ProfileAvatar userId={student.student_id} fullName={student.full_name} />
    <span className="students-identity-text">
      <strong>{student.full_name}</strong>
      <span className="students-identity-meta">
        <span>Grade {student.grade}</span>
        {student.shared_class_count > 0 ? <span className="chip">{student.shared_class_count} shared {student.shared_class_count === 1 ? 'class' : 'classes'}</span> : null}
      </span>
    </span>
  </>

  return (
    <li className="students-row is-directory" style={{ viewTransitionName: `student-${student.student_id}` }}>
      {student.can_view_schedule
        ? <Link className="students-identity" viewTransition to={`/students/${student.student_id}`} state={navigationState}>{identity}</Link>
        : <div className="students-identity">{identity}</div>}
      <dl className="students-access">
        <AccessFact label="Access to your schedule" value={student.they_can_view_yours} />
        <AccessFact label="Access to their schedule" value={student.you_can_view_theirs} />
      </dl>
      <div className="students-row-actions">
        {student.they_can_view_yours === 'no_access' ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => onAction('allow')}>{isActing && acting?.action === 'allow' ? actionLabel : 'Allow access'}</button> : null}
        {student.they_can_view_yours === 'approved_by_you' ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => onAction('remove')}>{isActing && acting?.action === 'remove' ? actionLabel : 'Remove access'}</button> : null}
        {student.you_can_view_theirs === 'private' && !student.outgoing_request_pending ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => onAction('request')}>{isActing && acting?.action === 'request' ? actionLabel : 'Request access'}</button> : null}
        {student.you_can_view_theirs === 'private' && student.outgoing_request_pending ? <span className="students-requested">
          <span className="badge badge-info">Access requested</span>
          <button className="text-button" type="button" disabled={busy} onClick={() => onAction('cancel')}>{isActing && acting?.action === 'cancel' ? actionLabel : 'Cancel request'}</button>
        </span> : null}
        {student.can_view_schedule ? <Link className="button button-ghost students-view-link" viewTransition to={`/students/${student.student_id}`} state={navigationState}>View schedule<ChevronRight aria-hidden="true" /></Link> : null}
      </div>
      {error ? <p className="form-error students-row-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
    </li>
  )
}
