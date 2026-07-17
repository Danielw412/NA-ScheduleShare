import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { adminUpdateGuestExplorationEnabled, getGuestExplorationEnabled } from '../../lib/supabase/guestAccess'

export function AdminGuestAccessControl() {
  const { isDemo } = useAuth()
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (isDemo) return
    let active = true
    setLoading(true)
    void getGuestExplorationEnabled()
      .then((value) => { if (active) setEnabled(value) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load guest access settings.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isDemo])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (!isDemo) await adminUpdateGuestExplorationEnabled(enabled)
      setMessage(enabled
        ? 'Guests can now explore public ScheduleShare pages.'
        : 'Guest exploration is off. Signed-out visitors are limited to the homepage and Upload My Schedule.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save guest access settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="admin-section"><p className="muted">Loading guest access settings…</p></section>

  return (
    <section className="admin-section homepage-stat-settings" aria-labelledby="guest-access-heading">
      <div>
        <h2 id="guest-access-heading">Guest access</h2>
        <p>Control whether signed-out visitors can browse ScheduleShare before creating an account.</p>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
      <form onSubmit={(event) => void save(event)}>
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>
            <strong>Allow guests to explore ScheduleShare</strong>
            <small>When off, guests see only the homepage and the Upload My Schedule action. Guest navigation, previews, feature links, and public discovery routes are removed.</small>
          </span>
        </label>
        <button className="button button-primary" disabled={saving || isDemo}>{saving ? 'Saving…' : 'Save guest access'}</button>
        {isDemo ? <small className="muted">Connect Supabase to save this setting.</small> : null}
      </form>
    </section>
  )
}
