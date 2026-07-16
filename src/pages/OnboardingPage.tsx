import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/ui/BrandLogo'
import { useAuth } from '../features/auth/AuthProvider'
import type { Grade, PrivacySetting } from '../lib/domain'

export function OnboardingPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState(auth.profile?.full_name === 'New Student' ? '' : auth.profile?.full_name ?? '')
  const [grade, setGrade] = useState<Grade | ''>(auth.profile?.grade ?? '')
  const [privacy, setPrivacy] = useState<PrivacySetting>('classmates')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!auth.user) return <Navigate to="/auth" replace />
  if (auth.profile?.onboarding_completed) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!grade) return
    setBusy(true)
    setError(null)
    try {
      await auth.completeOnboarding({ fullName, grade, privacySetting: privacy })
      void navigate('/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <BrandLogo />
      <form className="onboarding-form" onSubmit={(event) => void submit(event)}>
        <span className="step-label">Step 1 of 1</span>
        <h1>Set up your student profile</h1>
        <p>This information helps classmates find the right person. You can change privacy later.</p>
        <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <fieldset>
          <legend>Grade</legend>
          <div className="grade-options">
            {[9, 10, 11, 12].map((value) => <label key={value}><input type="radio" name="grade" value={value} checked={grade === value} onChange={() => setGrade(value as Grade)} />{value}</label>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Who can find you and view your schedule?</legend>
          <div className="privacy-options">
            <label><input type="radio" name="privacy" checked={privacy === 'private'} onChange={() => setPrivacy('private')} /><span><strong>Private</strong><small>Hidden from other students' rosters and schedule views.</small></span></label>
            <label><input type="radio" name="privacy" checked={privacy === 'classmates'} onChange={() => setPrivacy('classmates')} /><span><strong>Classmates</strong><small>Anyone sharing a class sees you in all your rosters and can view your schedule.</small></span></label>
            <label><input type="radio" name="privacy" checked={privacy === 'school'} onChange={() => setPrivacy('school')} /><span><strong>Anyone</strong><small>Any active signed-in student can find you and view your schedule.</small></span></label>
          </div>
        </fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary button-block" disabled={busy || !grade}>{busy ? 'Saving…' : 'Continue to NA ScheduleShare'}</button>
      </form>
    </main>
  )
}
