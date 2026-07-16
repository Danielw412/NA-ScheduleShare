import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { brand } from '../config/brand'
import { BrandLogo } from '../components/ui/BrandLogo'
import { useAuth } from '../features/auth/AuthProvider'

export function AuthPage() {
  const auth = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (auth.user && !auth.loading) return <Navigate to={auth.profile?.onboarding_completed ? '/' : '/onboarding'} replace />

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === 'sign-in') await auth.signInWithPassword(email, password)
      else {
        await auth.signUpWithPassword(email, password)
        setMessage('Check your email to confirm your account, then return here to sign in.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <BrandLogo logoPath="na-club-logo-dark.png" />
        <div>
          <h1>Find your people.<br />Build your schedule.</h1>
          <p>Compare A/B-day classes with classmates while keeping control of who can see your full schedule.</p>
        </div>
        <p>{brand.attribution}</p>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <h2>{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
          <p>{mode === 'sign-in' ? 'Sign in to continue to your schedule.' : 'Anyone with the school link can join.'}</p>
          {auth.configurationMissing ? (
            <div className="notice-box error"><AlertCircle aria-hidden="true" /><span>Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and add the project URL and publishable key.</span></div>
          ) : null}
          <button className="button google-button" type="button" disabled={busy || auth.configurationMissing} onClick={() => void auth.signInWithGoogle().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Google sign-in failed.'))}>
            <span aria-hidden="true">G</span> Continue with Google
          </button>
          <p className="google-note"><strong>Use a personal Google account.</strong> School-managed accounts may block sign-in.</p>
          <div className="form-divider"><span>or use email</span></div>
          <form onSubmit={(event) => void handleEmail(event)}>
            <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {message ? <p className="form-success" role="status">{message}</p> : null}
            <button className="button button-primary button-block" disabled={busy || auth.configurationMissing}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="text-button" type="button" onClick={() => setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in')}>
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </section>
    </main>
  )
}
