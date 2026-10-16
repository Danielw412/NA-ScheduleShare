import { AlertCircle, MailCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { rememberAuthDestination } from '../../lib/authDestination'
import { BrandMark } from '../ui/BrandMark'

type AuthMode = 'sign-in' | 'sign-up' | 'forgot'

interface AuthFormProps {
  initialMode?: 'sign-in' | 'sign-up'
  next?: string
  /** Id for the visible heading, so a surrounding dialog can be named by it. */
  headingId?: string
}

const copy: Record<AuthMode, { title: string; lede: string; submit: string; busy: string }> = {
  'sign-in': {
    title: 'Sign in',
    lede: 'Welcome back. Sign in to see your schedule and find classmates.',
    submit: 'Sign in',
    busy: 'Signing in…',
  },
  'sign-up': {
    title: 'Create your account',
    lede: 'Save your schedule and see who’s in your classes. We won’t spam your inbox.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  forgot: {
    title: 'Reset your password',
    lede: 'Enter the email you signed up with and we’ll send you a link to choose a new password.',
    submit: 'Send reset link',
    busy: 'Sending link…',
  },
}

function GoogleLogo() {
  // Google's brand colors are fixed by their sign-in guidelines.
  return (
    <svg className="auth-google-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export function AuthForm({
  initialMode = 'sign-in',
  next = '/schedule',
  headingId,
}: AuthFormProps) {
  const auth = useAuth()
  const fallbackHeadingId = useId()
  const emailId = useId()
  const passwordId = useId()
  const passwordHelpId = useId()
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const text = copy[mode]

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError(null)
    setMessage(null)
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      rememberAuthDestination(next)

      if (mode === 'forgot') {
        await auth.requestPasswordReset(email)
        setMessage('If an account uses that email, a reset link is on its way. Check your spam folder if you don’t see it in a few minutes.')
      } else if (mode === 'sign-in') {
        await auth.signInWithPassword(email, password)
      } else {
        await auth.signUpWithPassword(email, password)
        setMessage('Check your email and select Confirm my account. The link brings you back here and signs you in.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  function continueWithGoogle() {
    rememberAuthDestination(next)
    setError(null)
    setMessage(null)

    void auth.signInWithGoogle().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Google sign-in failed.')
    })
  }

  const disabled = busy || auth.configurationMissing

  return (
    <div className="auth-form" aria-busy={busy}>
      <header className="auth-form-header">
        <BrandMark className="brand-mark auth-form-mark" />
        <h2 id={headingId ?? fallbackHeadingId}>{text.title}</h2>
        <p>{text.lede}</p>
      </header>

      {auth.configurationMissing ? (
        <div className="notice notice-warning" role="alert">
          <AlertCircle aria-hidden="true" />
          <p>
            Sign-in isn’t set up on this copy of the site. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and add the Supabase project URL and publishable key.
          </p>
        </div>
      ) : null}

      {mode !== 'forgot' ? (
        <div className="auth-form-google">
          <button className="button button-secondary button-block auth-google-button" type="button" disabled={disabled} onClick={continueWithGoogle}>
            <GoogleLogo />
            Continue with Google
          </button>
          <p className="field-help">Use a personal Google account, not your school account.</p>
        </div>
      ) : null}

      {mode !== 'forgot' ? <div className="auth-form-divider"><span>or use email</span></div> : null}

      <form className="auth-form-fields" onSubmit={(event) => void handleEmail(event)}>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        {mode !== 'forgot' ? (
          <div className={mode === 'sign-in' ? 'field auth-password-field' : 'field'}>
            <label htmlFor={passwordId}>Password</label>
            <input
              id={passwordId}
              type="password"
              minLength={8}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              aria-describedby={mode === 'sign-up' ? passwordHelpId : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === 'sign-up' ? <p className="field-help" id={passwordHelpId}>Use at least 8 characters.</p> : null}
            {/* After the input so Tab goes Email, Password, then here; CSS shows it in the label row. */}
            {mode === 'sign-in' ? <button className="text-button auth-forgot-button" type="button" onClick={() => switchMode('forgot')}>Forgot password?</button> : null}
          </div>
        ) : null}

        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}

        {message ? (
          <div className="notice notice-success" role="status">
            <MailCheck aria-hidden="true" />
            <p>{message}</p>
          </div>
        ) : null}

        <button className="button button-primary button-block auth-submit" disabled={disabled}>
          {busy ? text.busy : text.submit}
        </button>
      </form>

      <p className="auth-form-switch">
        {mode === 'sign-in' ? <>New to ScheduleShare? <button className="text-button" type="button" onClick={() => switchMode('sign-up')}>Create an account</button></> : null}
        {mode === 'sign-up' ? <>Already have an account? <button className="text-button" type="button" onClick={() => switchMode('sign-in')}>Sign in</button></> : null}
        {mode === 'forgot' ? <button className="text-button" type="button" onClick={() => switchMode('sign-in')}>Back to sign in</button> : null}
      </p>
    </div>
  )
}
