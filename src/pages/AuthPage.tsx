import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AuthForm } from '../components/auth/AuthForm'
import { BrandLogo } from '../components/ui/BrandLogo'
import { brand } from '../config/brand'
import { useAuth } from '../features/auth/AuthProvider'
import { clearAuthDestination, pendingAuthDestination } from '../lib/authDestination'

function SignedInRedirect() {
  const destination = pendingAuthDestination()
  useEffect(() => clearAuthDestination(), [])
  return <Navigate to={destination} replace />
}

export function AuthPage() {
  const auth = useAuth()
  const [searchParams] = useSearchParams()

  if (auth.user && !auth.loading) {
    if (!auth.profile?.onboarding_completed) return <Navigate to="/onboarding" replace />
    return <SignedInRedirect />
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <BrandLogo logoPath="na-club-logo-dark.png" />
        <div>
          <h1>Find out who’s in your classes.</h1>
          <p>Upload a picture of your schedule, find classmates, and compare schedules with friends.</p>
        </div>
        <p>{brand.attribution}</p>
      </section>
      <section className="auth-form-panel">
        <AuthForm initialMode={searchParams.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in'} next={searchParams.get('next') ?? '/schedule'} />
      </section>
    </main>
  )
}
