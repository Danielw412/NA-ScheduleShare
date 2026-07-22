import { BookOpen, CalendarDays, Home, LogOut, Menu, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { useGuestAccountPrompt } from '../auth/GuestAccountPrompt'
import { BrandLogo } from '../ui/BrandLogo'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ScheduleAccessNotifications } from './ScheduleAccessNotifications'

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

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, profile, isAdmin, signOut } = useAuth()
  const { openAccountPrompt, openSignInPrompt } = useGuestAccountPrompt()
  const location = useLocation()
  const primaryNavigation = user ? authenticatedNavigation : guestNavigation
  return (
    <div className="app-shell has-mobile-bottom-nav">
      <header className="site-header">
        <NavLink to="/" className="brand-link" onClick={() => setMenuOpen(false)}><BrandLogo /></NavLink>
        <nav className={menuOpen ? 'primary-nav is-open' : 'primary-nav'} aria-label="Primary navigation">
          {primaryNavigation.map((item) => (
            <NavLink className={'mobileBottomDuplicate' in item && item.mobileBottomDuplicate ? 'mobile-bottom-duplicate' : undefined} key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)}>{item.label}</NavLink>
          ))}
          {!user ? <><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openSignInPrompt('/schedule') }}>Sign in</button><button className="guest-nav-auth guest-account-trigger" type="button" onClick={() => { setMenuOpen(false); openAccountPrompt('/schedule') }}>Create account</button></> : null}
          {user ? <button className="mobile-menu-only mobile-menu-sign-out" type="button" onClick={() => { setMenuOpen(false); void signOut() }}><LogOut size={17} aria-hidden="true" /> Sign out</button> : null}
        </nav>
        <div className="site-header-actions">
          {user ? <ScheduleAccessNotifications userId={user.id} /> : null}
          <button className="tablet-menu-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          {user ? <NavLink className="mobile-profile-button" to="/profile" aria-label="Open my profile" onClick={() => setMenuOpen(false)}>
            {profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={profile.updated_at} /> : <UserRound aria-hidden="true" />}
          </NavLink> : <button className="mobile-create-account-button button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button>}
          {user ? <div className="profile-menu">
            <NavLink to="/profile" aria-label="Open my profile">{profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={profile.updated_at} /> : <span className="avatar" aria-hidden="true">NA</span>}</NavLink>
            <div>
              <NavLink to="/profile"><strong>{profile?.full_name || 'Student'}</strong></NavLink>
            </div>
          </div> : <div className="guest-account-actions"><button className="text-button" type="button" onClick={() => openSignInPrompt('/schedule')}>Sign in</button><button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button></div>}
        </div>
      </header>
      <main className="page-container"><div className="page-transition" key={location.pathname}><Outlet /></div></main>
      <footer className="site-footer">
        <p>{brand.attribution}</p>
        <p className="footer-security"><ShieldCheck size={16} aria-hidden="true" /><span><strong>Security:</strong> Supabase row-level security enforces schedule privacy in the database, authenticated requests are permission-checked, and sensitive credentials stay server-side.</span></p>
        <nav aria-label="Footer navigation">
          {user ? <NavLink to="/profile">Profile & privacy</NavLink> : null}
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobileBottomNavigation.map(({ to, label, Icon }) => !user && to === '/students'
          ? <button key={to} type="button" onClick={() => openAccountPrompt(to)}>
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </button>
          : <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>)}
      </nav>
    </div>
  )
}
