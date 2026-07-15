import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { LoadingScreen } from '../ui/LoadingScreen'
import { SuspensionNotice } from './SuspensionNotice'

export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <LoadingScreen />
  if (auth.configurationMissing) return <Navigate to="/auth" replace />
  if (!auth.user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  if (auth.accountState?.suspended || auth.accountState?.deleted) return <SuspensionNotice />
  if (auth.profile && !auth.profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
