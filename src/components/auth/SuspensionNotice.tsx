import { ShieldAlert } from 'lucide-react'
import { BrandLogo } from '../ui/BrandLogo'
import { useAuth } from '../../features/auth/AuthProvider'

export function SuspensionNotice() {
  const { accountState, signOut } = useAuth()
  return (
    <main className="centered-state suspension-state">
      <BrandLogo />
      <ShieldAlert size={42} aria-hidden="true" />
      <h1>Account suspended</h1>
      <p>Your account cannot access NA ClassMatch right now.</p>
      {accountState?.suspension_reason ? <p className="notice-box"><strong>Reason:</strong> {accountState.suspension_reason}</p> : null}
      <p className="muted">Contact an administrator if you believe this was a mistake.</p>
      <button className="button button-secondary" type="button" onClick={() => void signOut()}>Sign out</button>
    </main>
  )
}
