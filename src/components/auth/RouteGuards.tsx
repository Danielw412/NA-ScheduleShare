import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useGuestAccountPrompt } from './GuestAccountPrompt'
import { SuspensionNotice } from './SuspensionNotice'

function AccountLoadFailure() {
  const { refreshProfile } = useAuth()
  return <section className="empty-state" role="alert">
    <h1>We couldn’t load your account</h1>
    <p>Your private account data is unavailable right now. Try again before continuing.</p>
    <button className="button button-primary" type="button" onClick={() => void refreshProfile().catch(() => undefined)}>Try again</button>
  </section>
}

export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  const { openSignInPrompt } = useGuestAccountPrompt()
  useEffect(() => {
    if (!auth.loading && !auth.user) openSignInPrompt(location.pathname)
  }, [auth.loading, auth.user, location.pathname, openSignInPrompt])
  if (auth.loading) return <LoadingScreen />
  if (!auth.user) return <Navigate to="/" replace />
  if (auth.accountState?.suspended || auth.accountState?.deleted) return <SuspensionNotice />
  if (!auth.profile) return <AccountLoadFailure />
  if (auth.profile && !auth.profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

export function AllowGuest() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <LoadingScreen />
  if (auth.user && (auth.accountState?.suspended || auth.accountState?.deleted)) return <SuspensionNotice />
  if (auth.user && !auth.profile) return <AccountLoadFailure />
  if (auth.user && auth.profile && !auth.profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const auth = useAuth()
  if (auth.loading) return <LoadingScreen />
  if (auth.user && !auth.profile) return <AccountLoadFailure />
  return auth.isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
