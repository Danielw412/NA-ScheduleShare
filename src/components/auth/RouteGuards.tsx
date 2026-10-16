import { CloudOff } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { StandaloneLayout } from '../account/StandaloneLayout'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useGuestAccountPrompt } from './GuestAccountPrompt'
import { SuspensionNotice } from './SuspensionNotice'

// Guards render this before the app shell mounts, so it uses the standalone frame.
function AccountLoadFailure() {
  const { refreshProfile, signOut } = useAuth()
  return <StandaloneLayout labelledBy="account-load-failure-title">
    <section className="panel account-standalone-panel account-standalone-message" role="alert">
      <span className="account-standalone-icon"><CloudOff aria-hidden="true" /></span>
      <h1 id="account-load-failure-title">We couldn’t load your account</h1>
      <p>Your profile and privacy settings didn’t load. To keep your schedule private, ScheduleShare won’t continue until they do. Check your connection and try again.</p>
      <div className="form-actions">
        <button className="button button-primary" type="button" onClick={() => void refreshProfile().catch(() => undefined)}>Try again</button>
        <button className="button button-ghost" type="button" onClick={() => void signOut().catch(() => undefined)}>Sign out</button>
      </div>
    </section>
  </StandaloneLayout>
}

export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  const { openSignInPrompt } = useGuestAccountPrompt()
  useEffect(() => {
    // Keep the query (for example a crash screen's ?error=REFERENCE) through sign-in.
    if (!auth.loading && !auth.user) openSignInPrompt(`${location.pathname}${location.search}`)
  }, [auth.loading, auth.user, location.pathname, location.search, openSignInPrompt])
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
  if (auth.loading) return <LoadingScreen fullscreen />
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
