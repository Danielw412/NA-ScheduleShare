import { BookOpen, CalendarDays, Clock3, House, Shuffle, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { BellScheduleProvider } from '../../features/bell/BellScheduleProvider'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { useGuestAccountPrompt } from '../auth/GuestAccountPrompt'
import { BellNowIndicator } from '../bell/BellNowIndicator'
import { useClubPrompt } from '../club/ClubPromptProvider'
import { ErrorBoundary } from '../errors/ErrorBoundary'
import { ErrorFallback } from '../errors/ErrorFallback'
import { addBreadcrumb, routeTemplate } from '../../lib/observability'
import { BrandLogo } from '../ui/BrandLogo'
import { AccountMenu } from './AccountMenu'
import { ScheduleAccessNotifications } from './ScheduleAccessNotifications'

interface NavItem {
  to: string
  label: string
  shortLabel: string
  Icon: LucideIcon
  requiresAccount?: boolean
  /** Shown in the desktop sidebar only; mobile reaches it from the live bell pill. */
  sidebarOnly?: boolean
}

export const navigation: NavItem[] = [
  { to: '/', label: 'Today', shortLabel: 'Today', Icon: House },
  { to: '/schedule', label: 'My schedule', shortLabel: 'Schedule', Icon: CalendarDays },
  { to: '/bell', label: 'Bell schedule', shortLabel: 'Bells', Icon: Clock3, sidebarOnly: true },
  { to: '/classes', label: 'Classes', shortLabel: 'Classes', Icon: BookOpen },
  { to: '/students', label: 'Students', shortLabel: 'Students', Icon: Users, requiresAccount: true },
  { to: '/schedule-engine', label: 'Schedule Engine', shortLabel: 'Engine', Icon: Shuffle, requiresAccount: true },
]

export function pageTransitionKey(pathname: string): string {
  return pathname === '/classes' || pathname.startsWith('/classes/') ? '/classes' : pathname
}

/** Screens that already show the live bell prominently hide the shell's copy. */
function showsOwnBell(pathname: string): boolean {
  return pathname === '/' || pathname === '/bell'
}

/** The app frame. The bell calendar loads here, only for screens that show it. */
export function AppShell() {
  return <BellScheduleProvider><AppFrame /></BellScheduleProvider>
}

function AppFrame() {
  const { user } = useAuth()
  const { openAccountPrompt, openSignInPrompt } = useGuestAccountPrompt()
  const { openClubDialog, whyScheduleShareEnabled } = useClubPrompt()
  const location = useLocation()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(location.pathname)
  const hideShellBell = showsOwnBell(location.pathname)

  // Route changes start at the top and move focus to the new content so
  // keyboard and screen-reader users are not left on the old link.
  useEffect(() => {
    if (previousPath.current === location.pathname) return
    const sameSection = pageTransitionKey(previousPath.current) === pageTransitionKey(location.pathname)
    addBreadcrumb({ category: 'navigation', message: `${routeTemplate(previousPath.current)} → ${routeTemplate(location.pathname)}` })
    previousPath.current = location.pathname
    if (sameSection) return
    window.scrollTo({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  function navLink(item: NavItem, variant: 'sidebar' | 'tabbar') {
    const label = variant === 'sidebar' ? item.label : item.shortLabel
    const content = <><item.Icon aria-hidden="true" /><span>{label}</span></>
    if (!user && item.requiresAccount) {
      return <button className="nav-item" type="button" onClick={() => openAccountPrompt(item.to)}>{content}</button>
    }
    return <NavLink className="nav-item" to={item.to} end={item.to === '/'} viewTransition>{content}</NavLink>
  }

  const notifications = user ? <ScheduleAccessNotifications key={user.id} userId={user.id} variant={isDesktop ? 'row' : 'icon'} /> : null

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>Skip to content</a>

      <aside className="sidebar" aria-label="Site">
        <NavLink className="sidebar-brand" to="/" viewTransition><BrandLogo /></NavLink>
        <nav className="sidebar-nav" aria-label="Primary">
          <ul>
            {navigation.map((item) => <li key={item.to}>{navLink(item, 'sidebar')}</li>)}
          </ul>
        </nav>
        <div className="sidebar-now">{isDesktop && !hideShellBell ? <BellNowIndicator variant="sidebar" /> : null}</div>
        <div className="sidebar-account">
          {user
            ? <>{isDesktop ? notifications : null}{isDesktop ? <AccountMenu variant="sidebar" /> : null}</>
            : <div className="sidebar-guest">
              <p>Make an account to see who’s in your classes.</p>
              <button className="button button-primary button-block" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button>
              <button className="button button-ghost button-block" type="button" onClick={() => openSignInPrompt('/schedule')}>Sign in</button>
            </div>}
        </div>
      </aside>

      <header className="topbar">
        <NavLink className="topbar-brand" to="/" aria-label={`${brand.siteName} home`} viewTransition><BrandLogo compact /></NavLink>
        <div className="topbar-now">{!isDesktop && !hideShellBell ? <BellNowIndicator variant="pill" /> : null}</div>
        <div className="topbar-actions">
          {user
            ? <>{!isDesktop ? notifications : null}{!isDesktop ? <AccountMenu variant="topbar" /> : null}</>
            : <button className="button button-secondary button-sm" type="button" onClick={() => openSignInPrompt('/schedule')}>Sign in</button>}
        </div>
      </header>

      <main className="main" id="main-content" ref={mainRef} tabIndex={-1}>
        <div className="main-inner page-transition" key={pageTransitionKey(location.pathname)}>
          {/* A crash inside one page keeps the shell and navigation usable. */}
          <ErrorBoundary scope="route" resetKeys={[location.pathname]} fallback={(props) => <ErrorFallback {...props} />}>
            <Outlet />
          </ErrorBoundary>
        </div>
        <footer className="site-footer">
          <p>{brand.attribution}</p>
          <nav aria-label="Footer">
            {whyScheduleShareEnabled ? <NavLink to="/why-scheduleshare">Why ScheduleShare?</NavLink> : null}
            <button type="button" onClick={openClubDialog}>Join the Computer and AI Club</button>
            <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">Source on GitHub</a>
          </nav>
        </footer>
      </main>

      <nav className="tabbar" aria-label="Primary">
        <ul>
          {navigation.filter((item) => !item.sidebarOnly).map((item) => <li key={item.to}>{navLink(item, 'tabbar')}</li>)}
        </ul>
      </nav>
    </div>
  )
}
