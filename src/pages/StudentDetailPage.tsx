import { AlertCircle, CheckCircle2, Eye, Flag, LockKeyhole } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { GuestSchedulePrompt } from '../components/auth/GuestSchedulePrompt'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { PageHeader } from '../components/ui/PageHeader'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchoolDayDefaults } from '../features/students/useSchoolDayDefaults'
import { useNoIndex } from '../hooks/useNoIndex'
import { demoEnrollments } from '../lib/demo-data'
import type { ReportableUser, ScheduleEnrollment, SemesterTerm, StudentDirectoryResult } from '../lib/domain'
import {
  cancelScheduleAccessRequest,
  getVisibleSchedule,
  requestScheduleAccess,
  scheduleAccessChangedEvent,
  searchReportableUsers,
  searchStudentDirectory,
} from '../lib/supabase/data'
import type { StudentNavigationState } from './StudentsPage'

type AccessReason = StudentDirectoryResult['you_can_view_theirs']
type NavigationState = Partial<StudentNavigationState>

type RequestStatus = 'idle' | 'sending' | 'sent' | 'canceling'
/** Where keyboard focus goes after the control that had it is replaced. */
type FocusTarget = 'sent-notice' | 'request-button' | 'cancel-button' | 'view-heading'

function firstName(student: ReportableUser | null): string | null {
  return student?.full_name.trim().split(/\s+/)[0] || null
}

function accessSentence(access: AccessReason | undefined, name: string | null): string {
  const who = name ?? 'This student'
  if (access === 'shared_class') return 'You can see this schedule because you share a class.'
  if (access === 'everyone_allowed') return `${who} shares their schedule with everyone at school.`
  if (access === 'approved_by_them') return `${who} approved your request to see this schedule.`
  if (access === 'admin') return 'You can see this schedule as an administrator.'
  return 'You have access to this schedule.'
}

function isFocusInside(container: Element | null | undefined): boolean {
  const focused = document.activeElement
  return Boolean(container && focused && container.contains(focused))
}

function StudentTitle({ student }: { student: ReportableUser }) {
  return (
    <span className="students-detail-title" style={{ viewTransitionName: `student-${student.student_id}` }}>
      <ProfileAvatar userId={student.student_id} fullName={student.full_name} className="students-detail-avatar" />
      <span>{student.full_name}</span>
    </span>
  )
}

export function StudentDetailPage() {
  const { studentId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isDemo } = useAuth()
  const { showToast } = useToast()
  const schoolDay = useSchoolDayDefaults()
  useNoIndex(!user)
  const navigationState = location.state as NavigationState | null
  const navigationUser = navigationState?.reportedUser
  const navigationAccess = navigationUser?.student_id === studentId ? navigationState?.access : undefined
  const [student, setStudent] = useState<ReportableUser | null>(navigationUser ?? null)
  const [pickedTerm, setPickedTerm] = useState<SemesterTerm | null>(null)
  const term: SemesterTerm = pickedTerm ?? schoolDay.semester ?? 'semester_1'
  const [schedule, setSchedule] = useState<ScheduleEnrollment[]>([])
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)
  // Bumped whenever schedule access changes anywhere (a request is sent,
  // approved, declined, or removed), so the page can load again in place.
  const [accessVersion, setAccessVersion] = useState(0)
  // The reason in router state is only a hint from the list the student came
  // from; once access has changed on this page it may no longer be true.
  const [navigationAccessStale, setNavigationAccessStale] = useState(false)
  const loadedFor = useRef<string | null>(null)
  const deniedRef = useRef(false)
  const focusTarget = useRef<FocusTarget | null>(null)
  const sentNoticeRef = useRef<HTMLParagraphElement>(null)
  const requestButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const lockedHeadingRef = useRef<HTMLHeadingElement>(null)
  const scheduleHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const reload = () => setAccessVersion((current) => current + 1)
    window.addEventListener(scheduleAccessChangedEvent, reload)
    return () => window.removeEventListener(scheduleAccessChangedEvent, reload)
  }, [])

  useEffect(() => {
    let active = true
    const loadKey = `${user?.id ?? ''}:${studentId}`
    // A reload for the same student keeps what is on screen until the answer
    // arrives, so an approval swaps the locked view for the schedule in place.
    const reloading = loadedFor.current === loadKey
    loadedFor.current = loadKey
    if (!reloading) {
      setSchedule([])
      setDenied(false)
      deniedRef.current = false
      setLoading(true)
      setRequestStatus('idle')
      setRequestError(null)
      setNavigationAccessStale(false)
    }
    if (!user) {
      setLoading(false)
      return () => { active = false }
    }
    const showDenied = (nextDenied: boolean) => {
      const switching = reloading && deniedRef.current !== nextDenied
      if (nextDenied || switching) setNavigationAccessStale(true)
      // Keyboard focus inside the view being replaced moves to the new view's heading.
      const currentView = (nextDenied ? scheduleHeadingRef.current : lockedHeadingRef.current)?.closest('section')
      if (switching && isFocusInside(currentView)) focusTarget.current = 'view-heading'
      deniedRef.current = nextDenied
      setDenied(nextDenied)
    }
    const request = isDemo ? Promise.resolve(demoEnrollments) : getVisibleSchedule(studentId)
    void request
      .then((nextSchedule) => {
        if (!active) return
        setSchedule(nextSchedule)
        showDenied(false)
      })
      .catch(() => { if (active) showDenied(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessVersion, isDemo, studentId, user?.id])

  // A request sent earlier (from the All students list, or before a reload)
  // is still pending: show it as sent rather than offering to send it again.
  const studentFirstName = firstName(student)
  const userId = user?.id
  useEffect(() => {
    if (!denied || isDemo || !userId || !studentFirstName) return
    let active = true
    void searchStudentDirectory({ query: studentFirstName })
      .then((results) => {
        const match = results.find((result) => result.student_id === studentId)
        if (!active || !match) return
        const pending = match.outgoing_request_pending
        if (pending && document.activeElement === requestButtonRef.current) focusTarget.current = 'sent-notice'
        if (!pending && document.activeElement === cancelButtonRef.current) focusTarget.current = 'request-button'
        setRequestStatus((current) => {
          if (current === 'sending' || current === 'canceling') return current
          return pending ? 'sent' : 'idle'
        })
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [accessVersion, denied, isDemo, studentFirstName, studentId, userId])

  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    const element = target === 'sent-notice'
      ? sentNoticeRef.current
      : target === 'request-button'
        ? requestButtonRef.current
        : target === 'cancel-button'
          ? cancelButtonRef.current
          : (denied ? lockedHeadingRef.current : scheduleHeadingRef.current)
    element?.focus()
  }, [denied, requestStatus])

  useEffect(() => {
    let active = true
    setStudent(navigationUser ?? null)
    if (!user) return () => { active = false }
    if (isDemo) {
      setStudent({ student_id: studentId, full_name: navigationUser?.full_name ?? 'Alex Morgan', grade: navigationUser?.grade ?? 11 })
      return () => { active = false }
    }
    void searchReportableUsers('', studentId)
      .then((results) => { if (active) setStudent(results[0] ?? null) })
      .catch(() => undefined)
    return () => { active = false }
  }, [isDemo, navigationUser?.full_name, navigationUser?.grade, navigationUser?.student_id, studentId, user?.id])

  // The button that was pressed is replaced (or was disabled while working),
  // so each outcome puts focus somewhere that says what happened.
  async function sendRequest() {
    setRequestStatus('sending')
    setRequestError(null)
    try {
      if (!isDemo) await requestScheduleAccess(studentId)
      focusTarget.current = 'sent-notice'
      setRequestStatus('sent')
    } catch (caught) {
      focusTarget.current = 'request-button'
      setRequestStatus('idle')
      setRequestError(caught instanceof Error ? caught.message : 'The access request could not be sent. Please try again.')
    }
  }

  async function cancelRequest() {
    setRequestStatus('canceling')
    setRequestError(null)
    try {
      if (!isDemo) await cancelScheduleAccessRequest(studentId)
      focusTarget.current = 'request-button'
      setRequestStatus('idle')
      showToast('Access request canceled.')
    } catch (caught) {
      focusTarget.current = 'cancel-button'
      setRequestStatus('sent')
      setRequestError(caught instanceof Error ? caught.message : 'The access request could not be canceled. Please try again.')
    }
  }

  if (!user) {
    return (
      <div className="page students-detail-page">
        <PageHeader title="Schedule locked" description="Sign in to see the schedules other students share with you." />
        <GuestSchedulePrompt open onClose={() => void navigate('/students', { replace: true })} />
      </div>
    )
  }

  const name = studentFirstName
  const back = { to: '/students', label: 'Students' }
  const header = (actions?: ReactNode) => (
    <PageHeader
      className="students-detail-header"
      back={back}
      title={student ? <StudentTitle student={student} /> : 'Student schedule'}
      description={student ? `Grade ${student.grade}` : undefined}
      actions={actions}
    />
  )

  if (denied) {
    const sent = requestStatus === 'sent' || requestStatus === 'canceling'
    return (
      <div className="page students-detail-page">
        {header()}
        <section className="students-locked" aria-labelledby="students-locked-title">
          <span className="students-locked-icon"><LockKeyhole aria-hidden="true" /></span>
          <div className="students-locked-text">
            <h2 id="students-locked-title" ref={lockedHeadingRef} tabIndex={-1}>This schedule isn’t available</h2>
            <p>You don’t have access to {name ? `${name}’s` : 'this student’s'} schedule right now. If they keep it private, you can ask to see it. They’ll get a notification and can choose to allow it.</p>
          </div>
          {sent ? (
            <div className="students-locked-sent">
              <p className="notice notice-success" role="status" ref={sentNoticeRef} tabIndex={-1}>
                <CheckCircle2 aria-hidden="true" />
                <span><strong>Request sent.</strong> Their schedule will show up here once {name ?? 'they'} {name ? 'allows' : 'allow'} it.</span>
              </p>
              <button className="text-button" type="button" ref={cancelButtonRef} disabled={requestStatus === 'canceling'} onClick={() => void cancelRequest()}>
                {requestStatus === 'canceling' ? 'Canceling…' : 'Cancel request'}
              </button>
            </div>
          ) : (
            <button className="button button-primary" type="button" ref={requestButtonRef} disabled={requestStatus === 'sending'} onClick={() => void sendRequest()}>
              {requestStatus === 'sending' ? 'Requesting…' : 'Request access'}
            </button>
          )}
          {requestError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{requestError}</p> : null}
        </section>
      </div>
    )
  }

  return (
    <div className="page students-detail-page">
      {header(student ? <Link className="text-button students-report-link" to="/report" state={{ reportedUser: student }}><Flag aria-hidden="true" />Report user</Link> : null)}
      <section className="section students-detail-schedule" aria-labelledby="students-schedule-title">
        <div className="section-header">
          <div>
            <h2 id="students-schedule-title" ref={scheduleHeadingRef} tabIndex={-1}>Schedule</h2>
            {loading ? null : <p className="students-detail-access"><Eye aria-hidden="true" />{accessSentence(navigationAccessStale ? undefined : navigationAccess, name)}</p>}
          </div>
          <TermSelector value={term} onChange={setPickedTerm} />
        </div>
        {loading ? (
          <div className="students-schedule-loading" role="status">
            <span className="sr-only">Loading schedule…</span>
            <span className="skeleton" aria-hidden="true" />
          </div>
        ) : <>
          {schedule.length === 0 ? <p className="empty-inline">{name ?? 'This student'} hasn’t added any classes yet.</p> : null}
          <ScheduleGrid
            enrollments={schedule}
            selectedTerm={term}
            onAdd={() => undefined}
            onRemove={() => undefined}
            onReplace={() => undefined}
            readOnly
            defaultMobileDay={schoolDay.dayType}
            todayDayType={schoolDay.todaySemester === term ? schoolDay.todayDayType : null}
          />
        </>}
      </section>
    </div>
  )
}
