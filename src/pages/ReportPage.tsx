import { AlertCircle, BookOpen, CircleHelp, Search, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import { demoEnrollments } from '../lib/demo-data'
import type { AdminReportRecord, ClassSearchResult, MeetingSlot, ReportableUser } from '../lib/domain'
import { compactMeetingSlotLabels } from '../lib/schedule'
import { searchClasses, searchReportableUsers, submitReport } from '../lib/supabase/data'

type ReportTargetType = 'none' | 'user' | 'class'

interface ReportLocationState {
  reportedUser?: ReportableUser
  reportedClass?: ClassSearchResult
}

const demoUsers: ReportableUser[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11 },
  { student_id: '40000000-0000-4000-8000-000000000002', full_name: 'Sam Rivera', grade: 10 },
]

const demoClasses: ClassSearchResult[] = demoEnrollments.map((enrollment, index) => ({
  ...enrollment.class,
  score: 100 - index,
}))

const targetOptions: { value: ReportTargetType; title: string; description: string; Icon: LucideIcon }[] = [
  { value: 'user', title: 'A student', description: 'A fake account or an inappropriate name.', Icon: UserRound },
  { value: 'class', title: 'A class', description: 'Wrong teacher or periods, or a duplicate class.', Icon: BookOpen },
  { value: 'none', title: 'Something else', description: 'Anything else on ScheduleShare that looks wrong.', Icon: CircleHelp },
]

const reasonOptions: { value: AdminReportRecord['reason_category']; label: string }[] = [
  { value: 'suspicious_user', label: 'Suspicious or fake account' },
  { value: 'inappropriate_name', label: 'Inappropriate name' },
  { value: 'incorrect_class_information', label: 'Wrong class information' },
  { value: 'duplicate_class', label: 'Duplicate class' },
  { value: 'other', label: 'Something else' },
]

function reportErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('reported_user_not_found')) return 'That student is no longer available to report. Search for the student again.'
  if (message.includes('reported_class_not_found')) return 'That class is no longer available to report. Search for the class again.'
  if (message.includes('rate_limit_exceeded')) return 'You have submitted several reports recently. Please try again later.'
  return message || 'Could not submit report.'
}

function SlotChips({ slots }: { slots: MeetingSlot[] }) {
  const labels = compactMeetingSlotLabels(slots)
  if (labels.length === 0) return null
  return <span className="chip-list report-slots">{labels.map((label) => <span className="chip" key={label}>{label}</span>)}</span>
}

export function ReportPage() {
  const { isDemo } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()
  const reasonId = useId()
  const explanationId = useId()
  const explanationHelpId = useId()
  const navigationState = location.state as ReportLocationState | null
  const initialUser = navigationState?.reportedUser
  const initialClass = navigationState?.reportedClass
  const [reason, setReason] = useState<AdminReportRecord['reason_category']>(initialClass ? 'incorrect_class_information' : initialUser ? 'suspicious_user' : 'other')
  // A crash screen links here with ?error=REFERENCE so admins can find the issue.
  const errorReference = new URLSearchParams(location.search).get('error')?.trim().toUpperCase() ?? ''
  const validErrorReference = /^[0-9A-F]{8}$/.test(errorReference) ? errorReference : null
  const [explanation, setExplanation] = useState(() => validErrorReference ? `Error reference: ${validErrorReference}\n\nWhat I was doing: ` : '')
  const [targetType, setTargetType] = useState<ReportTargetType>(initialClass ? 'class' : initialUser ? 'user' : 'none')
  const [selectedUser, setSelectedUser] = useState<ReportableUser | null>(initialUser ?? null)
  const [selectedClass, setSelectedClass] = useState<ClassSearchResult | null>(initialClass ?? null)
  const [userQuery, setUserQuery] = useState('')
  const [classQuery, setClassQuery] = useState('')
  const [userResults, setUserResults] = useState<ReportableUser[]>([])
  const [classResults, setClassResults] = useState<ClassSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // Search and verification problems show beside the picker; submit problems beside the button.
  const [targetError, setTargetError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Picking a target or pressing Change unmounts the focused button, so move
  // focus to its replacement instead of letting it drop to the page body.
  const changeButtonRef = useRef<HTMLButtonElement>(null)
  const targetSearchRef = useRef<HTMLInputElement>(null)
  const pendingTargetFocus = useRef<'change' | 'search' | null>(null)

  useEffect(() => {
    const pending = pendingTargetFocus.current
    if (!pending) return
    pendingTargetFocus.current = null
    if (pending === 'change') changeButtonRef.current?.focus()
    else targetSearchRef.current?.focus()
  }, [selectedClass, selectedUser])

  useEffect(() => {
    if (!initialUser?.student_id || isDemo) return
    let cancelled = false
    void searchReportableUsers('', initialUser.student_id).then((results) => {
      if (cancelled) return
      const verifiedUser = results[0]
      if (verifiedUser) setSelectedUser(verifiedUser)
      else {
        setSelectedUser(null)
        setTargetError('That student is no longer available to report. Search for the student again.')
      }
    }).catch(() => {
      if (!cancelled) setTargetError('Could not verify the selected student. Search for the student again.')
    })
    return () => { cancelled = true }
  }, [initialUser?.student_id, isDemo])

  useEffect(() => {
    if (targetType !== 'user' || selectedUser || userQuery.trim().length < 2) {
      setUserResults([])
      setSearching(false)
      return
    }
    let active = true
    setUserResults([])
    setTargetError(null)
    const timer = window.setTimeout(() => {
      setSearching(true)
      const normalizedQuery = userQuery.trim().toLowerCase()
      const request = isDemo
        ? Promise.resolve(demoUsers.filter((user) => user.full_name.toLowerCase().includes(normalizedQuery)))
        : searchReportableUsers(userQuery.trim())
      void request
        .then((results) => { if (active) setUserResults(results) })
        .catch((caught: unknown) => {
          if (!active) return
          setUserResults([])
          setTargetError(reportErrorMessage(caught))
        })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [isDemo, selectedUser, targetType, userQuery])

  useEffect(() => {
    if (targetType !== 'class' || selectedClass || classQuery.trim().length < 2) {
      setClassResults([])
      setSearching(false)
      return
    }
    let active = true
    setClassResults([])
    setTargetError(null)
    const timer = window.setTimeout(() => {
      setSearching(true)
      const normalizedQuery = classQuery.trim().toLowerCase()
      const request = isDemo
        ? Promise.resolve(demoClasses.filter((course) => `${course.course_name} ${course.teacher_last_name}`.toLowerCase().includes(normalizedQuery)))
        : searchClasses({ query: classQuery.trim() })
      void request
        .then((results) => { if (active) setClassResults(results) })
        .catch((caught: unknown) => {
          if (!active) return
          setClassResults([])
          setTargetError(reportErrorMessage(caught))
        })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [classQuery, isDemo, selectedClass, targetType])

  function changeTargetType(nextType: ReportTargetType) {
    setTargetType(nextType)
    setError(null)
    setTargetError(null)
    if (nextType === 'none') setReason('other')
    if (nextType === 'user' && reason === 'other') setReason('suspicious_user')
    if (nextType === 'class' && reason === 'other') setReason('incorrect_class_information')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (targetType === 'user' && !selectedUser) {
      setError('Search for and select the student you want to report.')
      return
    }
    if (targetType === 'class' && !selectedClass) {
      setError('Search for and select the class you want to report.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await submitReport({
        reason,
        explanation,
        reportedUserId: targetType === 'user' ? selectedUser?.student_id : undefined,
        reportedClassId: targetType === 'class' ? selectedClass?.id : undefined,
      })
      showToast('Report sent. An administrator will review it.')
      setExplanation('')
    } catch (caught) {
      setError(reportErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const targetMissing = targetType === 'user' ? !selectedUser : targetType === 'class' ? !selectedClass : false
  const targetErrorNode = targetError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{targetError}</p> : null

  return (
    <div className="page report-page">
      <PageHeader title="Report a problem" description="Tell an administrator about a student, a class, or anything else that looks wrong. Only you and administrators can see your report." />

      <form className="report-form" onSubmit={(event) => void submit(event)}>
        <fieldset className="account-choice-set">
          <legend>What are you reporting?</legend>
          <div className="account-choices">
            {targetOptions.map(({ value, title, description, Icon }) => (
              <label className="account-choice" key={value}>
                <input type="radio" name="report-target" value={value} checked={targetType === value} onChange={() => changeTargetType(value)} />
                <span className="account-choice-text"><strong>{title}</strong><small>{description}</small></span>
                <Icon className="account-choice-icon" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>

        {targetType === 'user' ? (
          <TargetPicker
            label="Which student?"
            selected={selectedUser ? <>
              <ProfileAvatar userId={selectedUser.student_id} fullName={selectedUser.full_name} />
              <span className="report-option-text"><strong>{selectedUser.full_name}</strong><small>Grade {selectedUser.grade}</small></span>
            </> : null}
            changeLabel="student"
            changeButtonRef={changeButtonRef}
            onChange={() => { pendingTargetFocus.current = 'search'; setSelectedUser(null); setUserQuery('') }}
            search={<>
              <label className="search-input">
                <Search aria-hidden="true" />
                <span className="sr-only">Search students by name</span>
                <input ref={targetSearchRef} value={userQuery} onChange={(event) => { setUserQuery(event.target.value); setTargetError(null) }} placeholder="Search by student name" autoComplete="off" enterKeyHint="search" />
              </label>
              {targetErrorNode}
              <div className="report-results" aria-live="polite">
                {searching ? <p className="report-results-note"><span className="spinner is-small" aria-hidden="true" />Searching…</p>
                  : userQuery.trim().length < 2 ? <p className="report-results-note">Type at least two letters of the student’s name.</p>
                    : userResults.length === 0 ? (targetError ? null : <p className="report-results-note">No students you can see match that name.</p>)
                      : <div className="list">{userResults.map((user) => (
                        <button className="list-row report-option" type="button" key={user.student_id} onClick={() => { pendingTargetFocus.current = 'change'; setSelectedUser(user); setUserQuery(''); setUserResults([]) }}>
                          <ProfileAvatar userId={user.student_id} fullName={user.full_name} />
                          <span className="report-option-text"><strong>{user.full_name}</strong><small>Grade {user.grade}</small></span>
                        </button>
                      ))}</div>}
              </div>
            </>}
          />
        ) : null}

        {targetType === 'class' ? (
          <TargetPicker
            label="Which class?"
            selected={selectedClass ? <>
              <span className="report-option-text"><strong>{selectedClass.course_name}</strong><small>{selectedClass.teacher_last_name}</small></span>
              <SlotChips slots={selectedClass.meeting_slots} />
            </> : null}
            changeLabel="class"
            changeButtonRef={changeButtonRef}
            onChange={() => { pendingTargetFocus.current = 'search'; setSelectedClass(null); setClassQuery('') }}
            search={<>
              <label className="search-input">
                <Search aria-hidden="true" />
                <span className="sr-only">Search classes by course or teacher</span>
                <input ref={targetSearchRef} value={classQuery} onChange={(event) => { setClassQuery(event.target.value); setTargetError(null) }} placeholder="Search course or teacher last name" autoComplete="off" enterKeyHint="search" />
              </label>
              {targetErrorNode}
              <div className="report-results" aria-live="polite">
                {searching ? <p className="report-results-note"><span className="spinner is-small" aria-hidden="true" />Searching…</p>
                  : classQuery.trim().length < 2 ? <p className="report-results-note">Type at least two letters of the course or teacher name.</p>
                    : classResults.length === 0 ? (targetError ? null : <p className="report-results-note">No classes match that search.</p>)
                      : <div className="list">{classResults.map((course) => (
                        <button className="list-row report-option" type="button" key={course.id} onClick={() => { pendingTargetFocus.current = 'change'; setSelectedClass(course); setClassQuery(''); setClassResults([]) }}>
                          <span className="report-option-text"><strong>{course.course_name}</strong><small>{course.teacher_last_name}</small></span>
                          <SlotChips slots={course.meeting_slots} />
                        </button>
                      ))}</div>}
              </div>
            </>}
          />
        ) : null}

        {targetType === 'none' ? targetErrorNode : null}

        <div className="field">
          <label htmlFor={reasonId}>What’s the problem?</label>
          <select id={reasonId} value={reason} onChange={(event) => setReason(event.target.value as AdminReportRecord['reason_category'])}>
            {reasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={explanationId}>Details <span className="report-optional">(optional)</span></label>
          <textarea id={explanationId} aria-describedby={explanationHelpId} maxLength={2000} rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
          <p className="field-help" id={explanationHelpId}>Say what you saw and where, so an administrator can check it quickly.</p>
        </div>

        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <div className="form-actions">
          <button className="button button-primary" disabled={busy || targetMissing}>{busy ? 'Sending…' : 'Send report'}</button>
          {targetMissing ? <p className="field-help">Choose the {targetType === 'user' ? 'student' : 'class'} first.</p> : null}
        </div>
      </form>
    </div>
  )
}

interface TargetPickerProps {
  label: string
  selected: ReactNode
  changeLabel: string
  changeButtonRef: RefObject<HTMLButtonElement | null>
  onChange: () => void
  search: ReactNode
}

function TargetPicker({ label, selected, changeLabel, changeButtonRef, onChange, search }: TargetPickerProps) {
  const labelId = useId()
  return (
    <div className="field report-target" role="group" aria-labelledby={labelId}>
      <span className="field-label" id={labelId}>{label}</span>
      {selected ? (
        <div className="report-selected">
          {selected}
          <button ref={changeButtonRef} className="button button-secondary button-sm" type="button" aria-label={`Change ${changeLabel}`} onClick={onChange}>Change</button>
        </div>
      ) : search}
    </div>
  )
}
