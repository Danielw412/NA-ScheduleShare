import { Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { useGuestAccountPrompt } from '../auth/GuestAccountPrompt'
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
  { to: '/schedule', label: 'Schedule' },
  { to: '/classes', label: 'View Classes' },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, profile, isAdmin, signOut } = useAuth()
  const { openAccountPrompt, openSignInPrompt } = useGuestAccountPrompt()
  const location = useLocation()
  const primaryNavigation = user ? authenticatedNavigation : guestNavigation
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" className="brand-link" onClick={() => setMenuOpen(false)}><BrandLogo /></NavLink>
        <button className="mobile-menu-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <nav className={menuOpen ? 'primary-nav is-open' : 'primary-nav'} aria-label="Primary navigation">
          {primaryNavigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
          ))}
          {!user ? <><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openSignInPrompt('/schedule') }}>Sign in</button><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openAccountPrompt('/schedule') }}>Create account</button></> : null}
          {isAdmin ? <NavLink to="/admin" onClick={() => setMenuOpen(false)}><ShieldCheck size={16} aria-hidden="true" /> Admin</NavLink> : null}
        </nav>
        {user ? <div className="profile-menu">
          <NavLink to="/profile" aria-label="Open my profile">{profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={profile.updated_at} /> : <span className="avatar" aria-hidden="true">NA</span>}</NavLink>
          <div>
            <NavLink to="/profile"><strong>{profile?.full_name || 'Student'}</strong></NavLink>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div> : <div className="guest-account-actions"><button className="text-button" type="button" onClick={() => openSignInPrompt('/schedule')}>Sign in</button><button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button></div>}
      </header>
      <main className="page-container"><div className="page-transition" key={location.pathname}><Outlet /></div></main>
      <footer className="site-footer">
        <p>{brand.attribution}</p>
        <nav aria-label="Footer navigation">
          {user ? <NavLink to="/profile">Profile & privacy</NavLink> : null}
          {user ? <NavLink to="/report">Report an issue</NavLink> : null}
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </div>
  )
}
