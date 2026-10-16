import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import { StandaloneLayout } from '../account/StandaloneLayout'

export function SuspensionNotice() {
  const { accountState, signOut } = useAuth()
  const deletedOnly = Boolean(accountState?.deleted && !accountState.suspended)
  return (
    <StandaloneLayout labelledBy="suspension-title">
      <section className="panel account-standalone-panel account-standalone-message">
        <span className="account-standalone-icon is-danger"><ShieldAlert aria-hidden="true" /></span>
        <h1 id="suspension-title">{deletedOnly ? 'This account was deleted' : 'Your account is suspended'}</h1>
        <p>{deletedOnly ? 'This account can no longer use NA ScheduleShare.' : 'You can’t use NA ScheduleShare while your account is suspended.'}</p>
        {accountState?.suspension_reason ? (
          <div className="account-suspension-reason">
            <h2>Reason from the administrator</h2>
            <p>{accountState.suspension_reason}</p>
          </div>
        ) : null}
        <p className="muted">If you think this is a mistake, contact a ScheduleShare administrator.</p>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section>
    </StandaloneLayout>
  )
}
