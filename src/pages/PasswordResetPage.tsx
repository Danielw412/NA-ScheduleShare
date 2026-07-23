import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { BrandLogo } from '../components/ui/BrandLogo'
import { useAuth } from '../features/auth/AuthProvider'

export function PasswordResetPage() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validationError = password.length < 8
    ? 'Use at least 8 characters.'
    : password !== confirmation
      ? 'The passwords do not match.'
      : null

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

  return <main className="password-reset-page">
    <BrandLogo />
    <section className="profile-card password-reset-card" aria-labelledby="password-reset-heading">
      <KeyRound size={34} aria-hidden="true" />
      <div><h1 id="password-reset-heading">Choose a new password</h1><p>This secure recovery link can be used once.</p></div>
      <form onSubmit={(event) => void submit(event)}>
        <label>New password<input autoComplete="new-password" minLength={8} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm new password<input autoComplete="new-password" minLength={8} required type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy || Boolean(validationError)}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </section>
  </main>
}
