import { Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { BrandLogo } from '../ui/BrandLogo'
import { ProfileAvatar } from '../ui/ProfileAvatar'

const primaryNavigation = [
  { to: '/', label: 'Home' },
  { to: '/schedule', label: 'My Schedule' },
  { to: '/classes', label: 'View Classes' },
  { to: '/students', label: 'Students' },
  { to: '/classmates', label: 'Classmates' },
  { to: '/profile', label: 'Profile' },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { profile, isAdmin, signOut } = useAuth()
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
          {isAdmin ? <NavLink to="/admin" onClick={() => setMenuOpen(false)}><ShieldCheck size={16} aria-hidden="true" /> Admin</NavLink> : null}
        </nav>
        <div className="profile-menu">
          <NavLink to="/profile" aria-label="Open my profile">{profile ? <ProfileAvatar userId={profile.id} fullName={profile.full_name} revision={profile.updated_at} /> : <span className="avatar" aria-hidden="true">NA</span>}</NavLink>
          <div>
            <NavLink to="/profile"><strong>{profile?.full_name || 'Student'}</strong></NavLink>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="page-container"><Outlet /></main>
      <footer className="site-footer">
        <p>{brand.attribution}</p>
        <nav aria-label="Footer navigation">
          <NavLink to="/profile">Profile & privacy</NavLink>
          <NavLink to="/report">Report an issue</NavLink>
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </div>
  )
}
