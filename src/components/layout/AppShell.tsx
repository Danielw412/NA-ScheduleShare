import { Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { useGuestAccess } from '../../features/guest/GuestAccessContext'
import { BrandLogo } from '../ui/BrandLogo'
import { ProfileAvatar } from '../ui/ProfileAvatar'

const authenticatedNavigation = [
  { to: '/', label: 'Home' },
  { to: '/schedule', label: 'My Schedule' },
  { to: '/classes', label: 'View Classes' },
  { to: '/students', label: 'Students' },
  { to: '/classmates', label: 'Classmates' },
  { to: '/profile', label: 'Profile' },
]

const guestNavigation = [
  { to: '/', label: 'Home' },
  { to: '/schedule', label: 'Schedule Preview' },
  { to: '/classes', label: 'View Classes' },
  { to: '/students', label: 'Students' },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, profile, isAdmin, signOut } = useAuth()
  const { explorationEnabled } = useGuestAccess()
  const location = useLocation()
  const primaryNavigation = user ? authenticatedNavigation : explorationEnabled ? guestNavigation : []
  const showGuestNavigation = !user && explorationEnabled
  const showPrimaryNavigation = Boolean(user) || explorationEnabled

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" className="brand-link" onClick={() => setMenuOpen(false)}><BrandLogo /></NavLink>
        {showPrimaryNavigation ? <button className="mobile-menu-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button> : null}
        {showPrimaryNavigation ? <nav className={menuOpen ? 'primary-nav is-open' : 'primary-nav'} aria-label="Primary navigation">
          {primaryNavigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
          ))}
          {showGuestNavigation ? <><NavLink className="guest-nav-auth" to="/auth" onClick={() => setMenuOpen(false)}>Sign in</NavLink><NavLink className="guest-nav-auth" to="/auth?mode=sign-up&next=/schedule" onClick={() => setMenuOpen(false)}>Create account</NavLink></> : null}
          {isAdmin ? <NavLink to="/admin" onClick={() => setMenuOpen(false)}><ShieldCheck size={16} aria-hidden="true" /> Admin</NavLink> : null}
        </nav> : null}
        {user ? <div className="profile-menu">
          <NavLink to="/profile" aria-label="Open my profile">{profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={profile.updated_at} /> : <span className="avatar" aria-hidden="true">NA</span>}</NavLink>
          <div>
            <NavLink to="/profile"><strong>{profile?.full_name || 'Student'}</strong></NavLink>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div> : showGuestNavigation ? <div className="guest-account-actions"><Link to="/auth">Sign in</Link><Link className="button button-primary" to="/auth?mode=sign-up&next=/schedule">Create account</Link></div> : null}
      </header>
      <main className="page-container"><div className="page-transition" key={location.pathname}><Outlet /></div></main>
      <footer className="site-footer">
        <p>{brand.attribution}</p>
        {user ? <nav aria-label="Footer navigation">
          <NavLink to="/profile">Profile & privacy</NavLink>
          <NavLink to="/report">Report an issue</NavLink>
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav> : explorationEnabled ? <nav aria-label="Footer navigation">
          <NavLink to="/students">Explore students</NavLink>
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav> : null}
      </footer>
    </div>
  )
}
