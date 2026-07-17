import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { GuestAccessContext } from '../../features/guest/GuestAccessContext'
import { getGuestExplorationEnabled } from '../../lib/supabase/guestAccess'
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

export function AllowGuest() {
  const auth = useAuth()
  const location = useLocation()
  const shouldLoadGuestSetting = !auth.loading && !auth.user && !auth.isDemo
  const [guestExplorationEnabled, setGuestExplorationEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!shouldLoadGuestSetting) {
      setGuestExplorationEnabled(null)
      return
    }
    let active = true
    setGuestExplorationEnabled(null)
    void getGuestExplorationEnabled()
      .then((enabled) => { if (active) setGuestExplorationEnabled(enabled) })
      .catch(() => { if (active) setGuestExplorationEnabled(true) })
    return () => { active = false }
  }, [shouldLoadGuestSetting])

  if (auth.loading || (shouldLoadGuestSetting && guestExplorationEnabled === null)) return <LoadingScreen />
  if (auth.user && (auth.accountState?.suspended || auth.accountState?.deleted)) return <SuspensionNotice />
  if (auth.user && auth.profile && !auth.profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  const explorationEnabled = auth.user || auth.isDemo ? true : guestExplorationEnabled ?? true
  if (!auth.user && !explorationEnabled && location.pathname !== '/') return <Navigate to="/" replace />

  return <GuestAccessContext.Provider value={{ explorationEnabled }}><Outlet /></GuestAccessContext.Provider>
}

export function RequireAdmin() {
  const { isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
