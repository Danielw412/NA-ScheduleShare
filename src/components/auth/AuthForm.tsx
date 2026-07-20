import { AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { rememberAuthDestination } from '../../lib/authDestination'
import { createGoogleNonce, loadGoogleIdentity } from '../../lib/googleIdentity'

interface AuthFormProps {
  initialMode?: 'sign-in' | 'sign-up'
  next?: string
}

export function AuthForm({
  initialMode = 'sign-in',
  next = '/schedule',
}: AuthFormProps) {
  const auth = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const googleButtonRef = useRef<HTMLDivElement>(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''
  const googleUnavailable = auth.configurationMissing || !googleClientId

  useEffect(() => {
    const currentButton = googleButtonRef.current
    if (currentButton === null || googleUnavailable) return

    const button: HTMLDivElement = currentButton
    let cancelled = false

    async function setupGoogleButton() {
      try {
        const [googleIdentity, { nonce, hashedNonce }] = await Promise.all([
          loadGoogleIdentity(),
          createGoogleNonce(),
        ])

        if (cancelled) return

        googleIdentity.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          nonce: hashedNonce,
          callback: (response) => {
            if (cancelled) return

            rememberAuthDestination(next)
            setBusy(true)
            setError(null)
            setMessage(null)

            void auth
              .signInWithGoogle(response.credential, nonce)
              .catch((caught: unknown) => {
                if (cancelled) return

                setError(
                  caught instanceof Error
                    ? caught.message
                    : 'Google sign-in failed.',
                )
              })
              .finally(() => {
                if (!cancelled) setBusy(false)
              })
          },
        })

        button.replaceChildren()

        const measuredWidth = Math.floor(
          button.getBoundingClientRect().width,
        )
        const width = Math.min(
          400,
          measuredWidth > 0 ? measuredWidth : 400,
        )

        googleIdentity.renderButton(button, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: String(width),
        })
      } catch (caught) {
        if (cancelled) return

        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not load Google sign-in.',
        )
      }
    }

    void setupGoogleButton()

    return () => {
      cancelled = true
      button.replaceChildren()
    }
  }, [
    auth.signInWithGoogle,
    googleClientId,
    googleUnavailable,
    next,
  ])

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      rememberAuthDestination(next)

      if (mode === 'sign-in') {
        await auth.signInWithPassword(email, password)
      } else {
        await auth.signUpWithPassword(email, password)
        setMessage(
          'Check your email and select Confirm my account. The link will bring you back here and sign you in securely.',
        )
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Authentication failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-form-wrap">
      <h2>{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>

      <p>
        {mode === 'sign-in'
          ? 'Sign in to continue to your schedule.'
          : "Don't worry, we won't spam you with emails!"}
      </p>

      {auth.configurationMissing ? (
        <div className="notice-box error">
          <AlertCircle aria-hidden="true" />
          <span>
            Supabase is not configured. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and add the project URL and publishable
            key.
          </span>
        </div>
      ) : null}

      {!auth.configurationMissing && !googleClientId ? (
        <div className="notice-box error">
          <AlertCircle aria-hidden="true" />
          <span>
            Google sign-in is not configured. Add{' '}
            <code>VITE_GOOGLE_CLIENT_ID</code> to the environment.
          </span>
        </div>
      ) : null}

      <div
        className={`google-button-host${busy ? ' is-busy' : ''}`}
        aria-busy={busy}
      >
        {googleUnavailable ? (
          <button
            className="button google-button"
            type="button"
            disabled
          >
            Continue with Google
          </button>
        ) : (
          <div
            ref={googleButtonRef}
            className="google-button-slot"
          />
        )}
      </div>

      <p className="google-note">
        <strong>Use a personal Google account.</strong> All data is stored
        securely on servers.
      </p>

      <div className="form-divider">
        <span>or use email</span>
      </div>

      <form onSubmit={(event) => void handleEmail(event)}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          Password
          <input
            type="password"
            minLength={8}
            autoComplete={
              mode === 'sign-in'
                ? 'current-password'
                : 'new-password'
            }
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}

        <button
          className="button button-primary button-block"
          disabled={busy || auth.configurationMissing}
        >
          {busy
            ? 'Please wait…'
            : mode === 'sign-in'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>

      <button
        className="text-button"
        type="button"
        onClick={() =>
          setMode((current) =>
            current === 'sign-in' ? 'sign-up' : 'sign-in',
          )
        }
      >
        {mode === 'sign-in'
          ? 'Need an account? Sign up'
          : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}