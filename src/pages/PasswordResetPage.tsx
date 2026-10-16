import { AlertCircle } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { StandaloneLayout } from '../components/account/StandaloneLayout'
import { useAuth } from '../features/auth/AuthProvider'

export function PasswordResetPage() {
  const auth = useAuth()
  const passwordId = useId()
  const passwordHelpId = useId()
  const confirmationId = useId()
  const mismatchId = useId()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validationError = password.length < 8
    ? 'Use at least 8 characters.'
    : password !== confirmation
      ? 'The passwords do not match.'
      : null
  // Only point out a mismatch once the student has typed a full confirmation.
  const showMismatch = password.length >= 8 && confirmation.length >= password.length && password !== confirmation

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.updateRecoveredPassword(password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be updated.')
      setBusy(false)
    }
  }

  return (
    <StandaloneLayout labelledBy="password-reset-heading">
      <form className="panel account-standalone-panel" onSubmit={(event) => void submit(event)}>
        <header className="account-standalone-header">
          <h1 id="password-reset-heading">Choose a new password</h1>
          <p>This reset link works once. When you save, you’ll go straight back to ScheduleShare, signed in.</p>
        </header>
        <div className="field">
          <label htmlFor={passwordId}>New password</label>
          <input id={passwordId} aria-describedby={passwordHelpId} autoComplete="new-password" minLength={8} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <p className="field-help" id={passwordHelpId}>Use at least 8 characters.</p>
        </div>
        <div className="field">
          <label htmlFor={confirmationId}>Confirm new password</label>
          <input id={confirmationId} aria-describedby={showMismatch ? mismatchId : undefined} aria-invalid={showMismatch || undefined} autoComplete="new-password" minLength={8} required type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          {showMismatch ? <p className="form-error" id={mismatchId}>The passwords do not match.</p> : null}
        </div>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <button className="button button-primary button-block" disabled={busy || Boolean(validationError)}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </StandaloneLayout>
  )
}
