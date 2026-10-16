import { ChevronsUpDown, CircleHelp, Flag, LogOut, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { useClubPrompt } from '../club/ClubPromptProvider'
import { ProfileAvatar } from '../ui/ProfileAvatar'

/**
 * Everything about the signed-in student's account in one place: profile and
 * privacy, reporting, administration, and signing out.
 */
export function AccountMenu({ variant }: { variant: 'sidebar' | 'topbar' }) {
  const { profile, user, avatarRevision, isAdmin, signOut } = useAuth()
  const { openClubDialog, whyScheduleShareEnabled } = useClubPrompt()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const location = useLocation()
  const fullName = profile?.full_name || 'Student'

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  if (!user) return null

  const avatar = profile
    ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={avatarRevision ?? profile.updated_at} className={variant === 'topbar' ? 'is-small' : ''} />
    : <span className={variant === 'topbar' ? 'avatar is-small' : 'avatar'} aria-hidden="true"><UserRound size={18} /></span>

  return (
    <div
      className={`account-menu is-${variant}`}
      ref={rootRef}
      onBlur={(event) => {
        // Close when keyboard focus moves somewhere outside the menu.
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        className="account-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${fullName}`}
        onClick={() => setOpen((current) => !current)}
      >
        {avatar}
        {variant === 'sidebar' ? <span className="account-menu-name"><strong>{fullName}</strong>{profile?.grade ? <small>Grade {profile.grade}</small> : null}</span> : null}
        {variant === 'sidebar' ? <ChevronsUpDown className="account-menu-chevron" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="account-menu-panel" id={panelId}>
          <div className="account-menu-identity">
            <strong>{fullName}</strong>
            {user.email ? <small>{user.email}</small> : null}
          </div>
          <nav aria-label="Account">
            <Link to="/profile" onClick={() => close()}><UserRound aria-hidden="true" />Profile and privacy</Link>
            <Link to="/report" onClick={() => close()}><Flag aria-hidden="true" />Report a problem</Link>
            {isAdmin ? <Link to="/admin" onClick={() => close()}><ShieldCheck aria-hidden="true" />Administration</Link> : null}
            {whyScheduleShareEnabled ? <Link to="/why-scheduleshare" onClick={() => close()}><CircleHelp aria-hidden="true" />Why ScheduleShare?</Link> : null}
            <button type="button" onClick={() => { close(true); openClubDialog() }}><Sparkles aria-hidden="true" />Join the Computer and AI Club</button>
          </nav>
          <button className="account-menu-signout" type="button" onClick={() => { close(); void signOut() }}><LogOut aria-hidden="true" />Sign out</button>
        </div>
      ) : null}
    </div>
  )
}
