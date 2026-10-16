import { AlertCircle } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrivacyOptions } from '../components/account/PrivacyOptions'
import { StandaloneLayout } from '../components/account/StandaloneLayout'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useAuth } from '../features/auth/AuthProvider'
import { clearAuthDestination, pendingAuthDestination } from '../lib/authDestination'
import type { Grade, PrivacySetting } from '../lib/domain'

const gradeOptions = [9, 10, 11, 12].map((value) => ({ value: String(value), label: String(value) }))

export function OnboardingPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const nameId = useId()
  const nameHelpId = useId()
  const [fullName, setFullName] = useState(auth.profile?.full_name === 'New Student' ? '' : auth.profile?.full_name ?? '')
  const [grade, setGrade] = useState<Grade | ''>(auth.profile?.grade ?? '')
  const [privacy, setPrivacy] = useState<PrivacySetting>('classmates')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!auth.user) return <Navigate to="/auth" replace />
  if (auth.profile?.onboarding_completed) return <Navigate to={pendingAuthDestination()} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!grade) return
    setBusy(true)
    setError(null)
    try {
      await auth.completeOnboarding({ fullName, grade, privacySetting: privacy })
      const destination = pendingAuthDestination()
      clearAuthDestination()
      void navigate(destination, { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StandaloneLayout labelledBy="onboarding-title">
      <form className="panel account-standalone-panel onboarding-form" onSubmit={(event) => void submit(event)}>
        <header className="account-standalone-header">
          <h1 id="onboarding-title">Set up your profile</h1>
          <p>Classmates find you by your name and grade. You can change your name and privacy later in Profile.</p>
        </header>

        <div className="field">
          <label htmlFor={nameId}>Full name</label>
          <input id={nameId} aria-describedby={nameHelpId} required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <p className="field-help" id={nameHelpId}>Use the name your classmates know you by.</p>
        </div>

        <div className="field">
          <span className="field-label" aria-hidden="true">Grade</span>
          <SegmentedControl label="Grade" block value={grade === '' ? '' : String(grade)} options={gradeOptions} onChange={(value) => setGrade(Number(value) as Grade)} />
        </div>

        <PrivacyOptions legend="Who can see your schedule?" value={privacy} onChange={setPrivacy} />

        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <div className="onboarding-submit">
          <button className="button button-primary button-block" disabled={busy || !grade}>{busy ? 'Saving…' : 'Save and continue'}</button>
          {!grade ? <p className="field-help">Choose your grade to continue.</p> : null}
        </div>
      </form>
    </StandaloneLayout>
  )
}
