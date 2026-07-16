import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import type { PrivacySetting } from '../lib/domain'

export function PrivacyPage() {
  const auth = useAuth()
  const [privacy, setPrivacy] = useState<PrivacySetting>(auth.profile?.privacy_setting ?? 'classmates')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!auth.profile?.grade) return
    setError(null)
    try {
      await auth.completeOnboarding({ fullName: auth.profile.full_name, grade: auth.profile.grade, privacySetting: privacy })
      setMessage('Privacy setting saved. Database policies apply the change immediately.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save privacy.')
    }
  }
  return (
    <div className="privacy-page narrow-page">
      <header className="page-heading"><div><h1>Privacy settings</h1><p>Choose who can find you in class rosters and view your full schedule.</p></div><ShieldCheck size={34} /></header>
      <form onSubmit={(event) => void save(event)}>
        <div className="privacy-options large">
          <label><input type="radio" name="privacy" checked={privacy === 'private'} onChange={() => setPrivacy('private')} /><span><strong>Private</strong><small>Other students cannot see you in class rosters or open your schedule.</small></span></label>
          <label><input type="radio" name="privacy" checked={privacy === 'classmates'} onChange={() => setPrivacy('classmates')} /><span><strong>Classmates</strong><small>Students who share any active class with you can see you in all your class rosters and view your schedule.</small></span></label>
          <label><input type="radio" name="privacy" checked={privacy === 'school'} onChange={() => setPrivacy('school')} /><span><strong>Anyone</strong><small>Any signed-in, non-suspended student can see you in your class rosters and view your schedule.</small></span></label>
        </div>
        <div className="notice-box"><ShieldCheck aria-hidden="true" /><span>Administrators can view all roster members. These rules are enforced by PostgreSQL Row Level Security, not by hiding buttons in the browser.</span></div>
        {message ? <p className="form-success" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary">Save privacy setting</button>
      </form>
    </div>
  )
}
