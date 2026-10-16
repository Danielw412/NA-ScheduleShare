import { LockKeyhole } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { useGuestAccountPrompt } from './GuestAccountPrompt'

export function GuestSchedulePrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openAccountPrompt } = useGuestAccountPrompt()
  if (!open) return null
  return (
    <Dialog
      title="Create an account to continue"
      description="Create an account and upload your schedule to view schedules from students who have chosen to share with you."
      onClose={onClose}
      size="small"
      className="students-guest-dialog"
      closeLabel="Close schedule prompt"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose}>Not now</button>
        <button className="button button-primary" type="button" onClick={() => { onClose(); openAccountPrompt('/schedule') }}>Create account</button>
      </>}
    >
      <p className="students-guest-dialog-note"><LockKeyhole aria-hidden="true" />Schedules are only shown to signed-in students, or to people a student sends a share link to.</p>
    </Dialog>
  )
}
