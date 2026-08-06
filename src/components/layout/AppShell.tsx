import { ArrowRight, BookOpen, CalendarCheck2, CalendarDays, Home, LogOut, Menu, Sparkles, UserRound, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility'
import { useGuestAccountPrompt } from '../auth/GuestAccountPrompt'
import { BrandLogo } from '../ui/BrandLogo'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ScheduleAccessNotifications } from './ScheduleAccessNotifications'
import './AppShell.css'

const clubSignUpUrl = 'https://forms.gle/mHSP39B3FnKvCfsv6'
const clubInterestUrl = 'https://forms.gle/p7xYrVRbx2AhWy2U7'

const authenticatedNavigation = [
  { to: '/', label: 'Home', mobileBottomDuplicate: true },
  { to: '/schedule', label: 'My Schedule', mobileBottomDuplicate: true },
  { to: '/classes', label: 'View Classes', mobileBottomDuplicate: true },
  { to: '/students', label: 'Students', mobileBottomDuplicate: true },
  { to: '/profile', label: 'Profile', mobileBottomDuplicate: false },
]

const guestNavigation = [
  { to: '/', label: 'Home', mobileBottomDuplicate: false },
  { to: '/schedule', label: 'Schedule', mobileBottomDuplicate: true },
  { to: '/classes', label: 'View Classes', mobileBottomDuplicate: true },
]

const mobileBottomNavigation = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/schedule', label: 'Schedule', Icon: CalendarDays },
  { to: '/classes', label: 'Classes', Icon: BookOpen },
  { to: '/students', label: 'Students', Icon: Users },
]

export function pageTransitionKey(pathname: string): string {
  return pathname === '/classes' || pathname.startsWith('/classes/') ? '/classes' : pathname
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [clubFormsOpen, setClubFormsOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { user, profile, avatarRevision, signOut } = useAuth()
  const { openAccountPrompt, openSignInPrompt } = useGuestAccountPrompt()
  const location = useLocation()
  const primaryNavigation = user ? authenticatedNavigation : guestNavigation
  const closeClubForms = useCallback(() => setClubFormsOpen(false), [])
  const clubFormsDialogRef = useDialogAccessibility(clubFormsOpen, closeClubForms)

  useEffect(() => {
    setMenuOpen(false)
    setClubFormsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div className="app-shell has-mobile-bottom-nav">
      <header className="site-header">
        <NavLink viewTransition to="/" className="brand-link" onClick={() => setMenuOpen(false)}><BrandLogo /></NavLink>
        <nav className={menuOpen ? 'primary-nav is-open' : 'primary-nav'} aria-label="Primary navigation" id="primary-navigation">
          {primaryNavigation.map((item) => (
            <NavLink viewTransition className={'mobileBottomDuplicate' in item && item.mobileBottomDuplicate ? 'mobile-bottom-duplicate' : undefined} key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
          ))}
          {!user ? <><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openSignInPrompt('/schedule') }}>Sign in</button><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openAccountPrompt('/schedule') }}>Create account</button></> : null}
          {user ? <button className="mobile-menu-only mobile-menu-sign-out" type="button" onClick={() => { setMenuOpen(false); void signOut() }}><LogOut size={17} aria-hidden="true" /> Sign out</button> : null}
        </nav>
        <div className="site-header-actions">
          {user ? <ScheduleAccessNotifications key={user.id} userId={user.id} /> : null}
          <button ref={menuButtonRef} className="tablet-menu-button" type="button" aria-controls="primary-navigation" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          {user ? <NavLink viewTransition className="mobile-profile-button" to="/profile" aria-label="Open my profile" onClick={() => setMenuOpen(false)}>
            {profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={avatarRevision ?? profile.updated_at} /> : <UserRound aria-hidden="true" />}
          </NavLink> : <button className="mobile-create-account-button button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button>}
          {user ? <div className="profile-menu">
            <NavLink viewTransition to="/profile" aria-label="View profile">{profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={avatarRevision ?? profile.updated_at} /> : <span className="avatar" aria-hidden="true">NA</span>}</NavLink>
            <div>
              <NavLink viewTransition to="/profile"><strong>{profile?.full_name || 'Student'}</strong></NavLink>
            </div>
          </div> : <div className="guest-account-actions"><button className="text-button" type="button" onClick={() => openSignInPrompt('/schedule')}>Sign in</button><button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button></div>}
        </div>
      </header>
      <main className="page-container"><div className="page-transition" key={pageTransitionKey(location.pathname)}><Outlet /></div></main>
      <footer className="site-footer">
        <p>{brand.attribution}</p>
        <nav aria-label="Footer navigation">
          {user ? <NavLink to="/profile">Profile & privacy</NavLink> : null}
          {user ? <NavLink to="/why-scheduleshare">Why ScheduleShare?</NavLink> : null}
          <button className="footer-link-button" type="button" onClick={() => setClubFormsOpen(true)}>Computer &amp; AI Club</button>
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
      {clubFormsOpen ? (
        <div className="dialog-backdrop club-forms-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClubForms() }}>
          <section className="club-forms-dialog" ref={clubFormsDialogRef} role="dialog" aria-modal="true" aria-labelledby="club-forms-dialog-title" aria-describedby="club-forms-dialog-description" tabIndex={-1}>
            <button className="icon-button club-forms-close" type="button" aria-label="Close Computer and AI Club forms" onClick={closeClubForms}><X aria-hidden="true" /></button>
            <header>
              <span className="club-forms-icon" aria-hidden="true"><Sparkles /></span>
              <p className="club-forms-eyebrow">Computer &amp; AI Club</p>
              <h2 id="club-forms-dialog-title">Which form do you need?</h2>
              <p id="club-forms-dialog-description">Explore the club without committing, or officially join the 2026–2027 member roster.</p>
            </header>
            <div className="club-form-options">
              <a className="club-form-option club-form-interest" href={clubInterestUrl} target="_blank" rel="noreferrer" onClick={closeClubForms}>
                <span className="club-form-option-icon" aria-hidden="true"><Sparkles /></span>
                <span className="club-form-option-copy"><strong>Interest form</strong><small>Nonbinding. Tell us what you want to learn or participate in.</small></span>
                <ArrowRight aria-hidden="true" />
              </a>
              <a className="club-form-option club-form-sign-up" href={clubSignUpUrl} target="_blank" rel="noreferrer" onClick={closeClubForms}>
                <span className="club-form-option-icon" aria-hidden="true"><CalendarCheck2 /></span>
                <span className="club-form-option-copy"><strong>Sign-up form</strong><small>Officially join the club for the 2026–2027 school year.</small></span>
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
            <p className="club-forms-note">Both forms open in a new tab.</p>
          </section>
        </div>
      ) : null}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobileBottomNavigation.map(({ to, label, Icon }) => !user && to === '/students'
          ? <button key={to} type="button" onClick={() => openAccountPrompt(to)}>
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </button>
          : <NavLink viewTransition key={to} to={to} end={to === '/'}>
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>)}
      </nav>
    </div>
  )
}
