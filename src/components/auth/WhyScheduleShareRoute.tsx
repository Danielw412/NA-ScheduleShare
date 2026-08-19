import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { getWhyScheduleShareEnabled } from '../../lib/supabase/data'

export function WhyScheduleShareRoute({ children }: { children: ReactNode }) {
  const { isDemo } = useAuth()
  const [enabled, setEnabled] = useState<boolean | null>(isDemo ? true : null)

  useEffect(() => {
    if (isDemo) {
      setEnabled(true)
      return
    }
    let active = true
    setEnabled(null)
    void getWhyScheduleShareEnabled()
      .then((nextEnabled) => { if (active) setEnabled(nextEnabled) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [isDemo])

  if (enabled === null) {
    return <div className="route-loading" role="status" aria-live="polite"><span className="loader" aria-hidden="true" /><p>Checking page availability…</p></div>
  }

  return enabled ? children : <Navigate to="/" replace />
}
