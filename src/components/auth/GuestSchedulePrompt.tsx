import { LockKeyhole, X } from 'lucide-react'
import { useGuestAccountPrompt } from './GuestAccountPrompt'

export function GuestSchedulePrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openAccountPrompt } = useGuestAccountPrompt()
  if (!open) return null
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="guest-lock-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-schedule-prompt-title">
        <button className="icon-button" type="button" aria-label="Close schedule prompt" onClick={onClose}><X aria-hidden="true" /></button>
        <LockKeyhole size={36} aria-hidden="true" />
        <h2 id="guest-schedule-prompt-title">Create an account to continue</h2>
        <p>Create an account and upload your schedule to view schedules from students who have chosen to share with you.</p>
        <div className="form-actions">
          <button className="button button-primary" type="button" onClick={() => { onClose(); openAccountPrompt('/schedule') }}>Create Account</button>
          <button className="button button-secondary" type="button" onClick={onClose}>Not now</button>
        </div>
      </section>
    </div>
  )
}
