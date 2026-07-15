import { Flag, Search, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { demoEnrollments } from '../lib/demo-data'
import type { AdminReportRecord, ClassSearchResult, ReportableUser } from '../lib/domain'
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

function reportErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('reported_user_not_found')) return 'That student is no longer available to report. Search for the student again.'
  if (message.includes('reported_class_not_found')) return 'That class is no longer available to report. Search for the class again.'
  if (message.includes('rate_limit_exceeded')) return 'You have submitted several reports recently. Please try again later.'
  return message || 'Could not submit report.'
}

export function ReportPage() {
  const { isDemo } = useAuth()
  const location = useLocation()
  const navigationState = location.state as ReportLocationState | null
  const initialUser = navigationState?.reportedUser
  const initialClass = navigationState?.reportedClass
  const [reason, setReason] = useState<AdminReportRecord['reason_category']>(initialClass ? 'incorrect_class_information' : initialUser ? 'suspicious_user' : 'other')
  const [explanation, setExplanation] = useState('')
  const [targetType, setTargetType] = useState<ReportTargetType>(initialClass ? 'class' : initialUser ? 'user' : 'none')
  const [selectedUser, setSelectedUser] = useState<ReportableUser | null>(initialUser ?? null)
  const [selectedClass, setSelectedClass] = useState<ClassSearchResult | null>(initialClass ?? null)
  const [userQuery, setUserQuery] = useState('')
  const [classQuery, setClassQuery] = useState('')
  const [userResults, setUserResults] = useState<ReportableUser[]>([])
  const [classResults, setClassResults] = useState<ClassSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!initialUser?.student_id || isDemo) return
    let cancelled = false
    void searchReportableUsers('', initialUser.student_id).then((results) => {
      if (cancelled) return
      const verifiedUser = results[0]
      if (verifiedUser) setSelectedUser(verifiedUser)
      else {
        setSelectedUser(null)
        setError('That student is no longer available to report. Search for the student again.')
      }
    }).catch(() => {
      if (!cancelled) setError('Could not verify the selected student. Search for the student again.')
    })
    return () => { cancelled = true }
  }, [initialUser?.student_id, isDemo])

  useEffect(() => {
    if (targetType !== 'user' || selectedUser || userQuery.trim().length < 2) {
      setUserResults([])
      return
    }
    const timer = window.setTimeout(() => {
      setSearching(true)
      const normalizedQuery = userQuery.trim().toLowerCase()
      const request = isDemo
        ? Promise.resolve(demoUsers.filter((user) => user.full_name.toLowerCase().includes(normalizedQuery)))
        : searchReportableUsers(userQuery.trim())
      void request.then(setUserResults).catch((caught: unknown) => setError(reportErrorMessage(caught))).finally(() => setSearching(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isDemo, selectedUser, targetType, userQuery])

  useEffect(() => {
    if (targetType !== 'class' || selectedClass || classQuery.trim().length < 2) {
      setClassResults([])
      return
    }
    const timer = window.setTimeout(() => {
      setSearching(true)
      const normalizedQuery = classQuery.trim().toLowerCase()
      const request = isDemo
        ? Promise.resolve(demoClasses.filter((course) => `${course.class_name} ${course.teacher_name}`.toLowerCase().includes(normalizedQuery)))
        : searchClasses({ query: classQuery.trim() })
      void request.then(setClassResults).catch((caught: unknown) => setError(reportErrorMessage(caught))).finally(() => setSearching(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [classQuery, isDemo, selectedClass, targetType])

  function changeTargetType(nextType: ReportTargetType) {
    setTargetType(nextType)
    setError(null)
    setMessage(null)
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
    setMessage(null)
    try {
      if (!isDemo) await submitReport({
        reason,
        explanation,
        reportedUserId: targetType === 'user' ? selectedUser?.student_id : undefined,
        reportedClassId: targetType === 'class' ? selectedClass?.id : undefined,
      })
      setMessage('Report submitted. An administrator can review it without exposing your report to other students.')
      setExplanation('')
    } catch (caught) {
      setError(reportErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const targetMissing = targetType === 'user' ? !selectedUser : targetType === 'class' ? !selectedClass : false

  return (
    <div className="report-page narrow-page">
      <header className="page-heading"><div><h1>Report an issue</h1><p>Reports are visible only to you and administrators.</p></div><Flag size={32} /></header>
      <form className="stacked-form" onSubmit={(event) => void submit(event)}>
        <label>What is the issue?<select value={reason} onChange={(event) => setReason(event.target.value as AdminReportRecord['reason_category'])}><option value="suspicious_user">Suspicious user</option><option value="inappropriate_name">Inappropriate name</option><option value="incorrect_class_information">Incorrect class information</option><option value="duplicate_class">Duplicate classes</option><option value="other">Other issue</option></select></label>
        <label>What are you reporting?<select value={targetType} onChange={(event) => changeTargetType(event.target.value as ReportTargetType)}><option value="none">General issue</option><option value="user">A user</option><option value="class">A class</option></select></label>

        {targetType === 'user' ? <div className="report-target-field"><span>Student</span>{selectedUser ? <div className="selected-report-target"><UserRound aria-hidden="true" /><span><strong>{selectedUser.full_name}</strong><small>Grade {selectedUser.grade}</small></span><button type="button" aria-label="Choose a different student" onClick={() => { setSelectedUser(null); setUserQuery('') }}><X size={17} /></button></div> : <><label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search students by name</span><input value={userQuery} onChange={(event) => { setUserQuery(event.target.value); setError(null) }} placeholder="Search by student name" autoComplete="off" /></label><div className="report-target-results" aria-live="polite">{searching ? <p className="muted">Searching…</p> : userQuery.trim().length < 2 ? <p className="muted">Enter at least two letters of the student’s name.</p> : userResults.length === 0 ? <p className="muted">No visible students match that name.</p> : userResults.map((user) => <button type="button" key={user.student_id} onClick={() => { setSelectedUser(user); setUserQuery(''); setUserResults([]) }}><strong>{user.full_name}</strong><small>Grade {user.grade}</small></button>)}</div></>}</div> : null}

        {targetType === 'class' ? <div className="report-target-field"><span>Class</span>{selectedClass ? <div className="selected-report-target"><span><strong>{selectedClass.class_name}</strong><small>{selectedClass.teacher_name}</small></span><button type="button" aria-label="Choose a different class" onClick={() => { setSelectedClass(null); setClassQuery('') }}><X size={17} /></button></div> : <><label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search classes by name or teacher</span><input value={classQuery} onChange={(event) => { setClassQuery(event.target.value); setError(null) }} placeholder="Search class or teacher" autoComplete="off" /></label><div className="report-target-results" aria-live="polite">{searching ? <p className="muted">Searching…</p> : classQuery.trim().length < 2 ? <p className="muted">Enter at least two letters of the class or teacher name.</p> : classResults.length === 0 ? <p className="muted">No classes match that search.</p> : classResults.map((course) => <button type="button" key={course.id} onClick={() => { setSelectedClass(course); setClassQuery(''); setClassResults([]) }}><strong>{course.class_name}</strong><small>{course.teacher_name} · {course.meeting_slots.map((slot) => `${slot.day_type} P${slot.period_number}`).join(', ')}</small></button>)}</div></>}</div> : null}

        <label>Optional explanation<textarea maxLength={2000} rows={6} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Include enough detail for an administrator to understand what happened." /></label>
        {message ? <p className="form-success" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy || targetMissing}>{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>
    </div>
  )
}
