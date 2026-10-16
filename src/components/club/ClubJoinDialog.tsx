import { ExternalLink } from 'lucide-react'
import { brand } from '../../config/brand'
import { BrandMark } from '../ui/BrandMark'
import { Dialog } from '../ui/Dialog'

export function ClubJoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <Dialog
      title="Join the NA Computer and AI Club"
      onClose={onClose}
      closeLabel="Close club dialog"
      size="small"
      className="club-dialog"
      footer={<>
        <a className="button button-secondary" href={brand.clubInterestFormUrl} target="_blank" rel="noreferrer" onClick={onClose}>Interest form<ExternalLink aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
        <a className="button button-primary" href={brand.clubSignUpFormUrl} target="_blank" rel="noreferrer" onClick={onClose}>Sign-up form<ExternalLink aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
      </>}
    >
      <div className="club-dialog-intro">
        <BrandMark className="brand-mark club-dialog-mark" />
        <div>
          <p>We’re the students who build ScheduleShare. We work on software and AI projects together, and you don’t need any experience to join.</p>
          <p className="muted">Not sure yet? Start with the interest form.</p>
        </div>
      </div>
    </Dialog>
  )
}
