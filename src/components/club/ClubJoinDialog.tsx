import { ExternalLink, X } from 'lucide-react'
import { brand } from '../../config/brand'
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility'

export function ClubJoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useDialogAccessibility(open, onClose)
  if (!open) return null
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="club-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="club-dialog-title" tabIndex={-1}>
        <button className="icon-button" type="button" aria-label="Close club dialog" onClick={onClose}><X aria-hidden="true" /></button>
        <img className="club-dialog-logo" src={`${import.meta.env.BASE_URL}${brand.logoPath}`} alt="" width={46} height={46} />
        <h2 id="club-dialog-title">Join the NA Computer and AI Club</h2>
        <p>We build real projects together — this website is one of them. Everyone is welcome, no experience needed.</p>
        <div className="club-dialog-actions">
          <a className="button button-primary" href={brand.clubSignUpFormUrl} target="_blank" rel="noreferrer" onClick={onClose}>Sign-up form <ExternalLink size={16} aria-hidden="true" /></a>
          <a className="button button-secondary" href={brand.clubInterestFormUrl} target="_blank" rel="noreferrer" onClick={onClose}>Interest form <ExternalLink size={16} aria-hidden="true" /></a>
        </div>
        <p className="club-dialog-note">Not sure yet? The interest form just keeps you in the loop.</p>
      </section>
    </div>
  )
}
