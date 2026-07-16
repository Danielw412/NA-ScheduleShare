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
            <span className="google-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
          </svg>
        </span>
Continue with Google
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
