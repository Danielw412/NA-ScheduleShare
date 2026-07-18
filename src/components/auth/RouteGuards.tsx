import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useGuestAccountPrompt } from './GuestAccountPrompt'
import { SuspensionNotice } from './SuspensionNotice'

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
  if (auth.user && auth.profile && !auth.profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
