import { Flag } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { submitReport } from '../lib/supabase/data'

export function ReportPage() {
  const { isDemo } = useAuth()
  const [params] = useSearchParams()
  const [reason, setReason] = useState('other')
  const [explanation, setExplanation] = useState('')
  const [targetType, setTargetType] = useState(params.get('class') ? 'class' : params.get('user') ? 'user' : 'none')
  const [targetId, setTargetId] = useState(params.get('class') ?? params.get('user') ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await submitReport({ reason, explanation, reportedUserId: targetType === 'user' ? targetId : undefined, reportedClassId: targetType === 'class' ? targetId : undefined })
      setMessage('Report submitted. An administrator can review it without exposing your report to other students.')
      setExplanation('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit report.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="report-page narrow-page">
      <header className="page-heading"><div><h1>Report an issue</h1><p>Reports are visible only to you and administrators.</p></div><Flag size={32} /></header>
      <form className="stacked-form" onSubmit={(event) => void submit(event)}>
        <label>What is the issue?<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="suspicious_user">Suspicious user</option><option value="inappropriate_name">Inappropriate name</option><option value="incorrect_class_information">Incorrect class information</option><option value="duplicate_class">Duplicate classes</option><option value="other">Other issue</option></select></label>
        <label>What are you reporting?<select value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="none">General issue</option><option value="user">A user</option><option value="class">A class</option></select></label>
        {targetType !== 'none' ? <label>{targetType === 'user' ? 'User ID' : 'Class ID'}<input required value={targetId} onChange={(event) => setTargetId(event.target.value)} /></label> : null}
        <label>Optional explanation<textarea maxLength={2000} rows={6} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Include enough detail for an administrator to understand what happened." /></label>
        {message ? <p className="form-success" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>
    </div>
  )
}
