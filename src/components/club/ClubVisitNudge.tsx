import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { brand } from '../../config/brand'
import { useAuth } from '../../features/auth/AuthProvider'
import { fetchSchedule } from '../../lib/supabase/data'

const NUDGE_KEY_PREFIX = 'scheduleshare:club-nudge:v1:'
const TICK_SECONDS = 10
const REQUIRED_ACTIVE_SECONDS = 180
const REQUIRED_VISITED_PAGES = 3
const RECHECK_SECONDS = 60

function nudgeAlreadySeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${NUDGE_KEY_PREFIX}${userId}`) !== null
  } catch {
    return true
  }
}

function rememberNudgeSeen(userId: string) {
  try {
    window.localStorage.setItem(`${NUDGE_KEY_PREFIX}${userId}`, new Date().toISOString())
  } catch {
    // Blocked storage only means the nudge can appear again on a later visit.
  }
}

// A quiet, one-time invitation for signed-in students who uploaded a schedule and stayed a while.
export function ClubVisitNudge() {
  const { user, isDemo } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [activeSeconds, setActiveSeconds] = useState(0)
  const [visitedPages, setVisitedPages] = useState(0)
  const visitedPaths = useRef(new Set<string>())
  const nextCheckSeconds = useRef(REQUIRED_ACTIVE_SECONDS)
  const checking = useRef(false)
  const settled = useRef(false)

  useEffect(() => {
    visitedPaths.current.add(location.pathname)
    setVisitedPages(visitedPaths.current.size)
  }, [location.pathname])

  useEffect(() => {
    setOpen(false)
    setActiveSeconds(0)
    nextCheckSeconds.current = REQUIRED_ACTIVE_SECONDS
    checking.current = false
    settled.current = false
  }, [user?.id])

  useEffect(() => {
    if (!user || isDemo) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      setActiveSeconds((seconds) => seconds + TICK_SECONDS)
    }, TICK_SECONDS * 1000)
    return () => window.clearInterval(interval)
  }, [isDemo, user])

  useEffect(() => {
    if (!user || isDemo || settled.current || checking.current) return
    if (activeSeconds < nextCheckSeconds.current || visitedPages < REQUIRED_VISITED_PAGES) return
    if (nudgeAlreadySeen(user.id)) {
      settled.current = true
      return
    }
    // Never stack this on top of an open dialog; wait for the next tick instead.
    if (document.querySelector('.dialog-backdrop')) return
    let active = true
    checking.current = true
    void fetchSchedule(user.id)
      .then((enrollments) => {
        if (!active) return
        if (enrollments.length === 0) {
          nextCheckSeconds.current = activeSeconds + RECHECK_SECONDS
          return
        }
        settled.current = true
        rememberNudgeSeen(user.id)
        setOpen(true)
      })
      .catch(() => undefined)
      .finally(() => { checking.current = false })
    return () => { active = false }
  }, [activeSeconds, isDemo, user, visitedPages])

  if (!open) return null
  return (
    <aside className="club-nudge" aria-label="Club invitation">
      <img className="club-nudge-logo" src={`${import.meta.env.BASE_URL}${brand.logoPath}`} alt="" width={34} height={34} />
      <div className="club-nudge-copy">
        <p><strong>This site was built by the NA Computer and AI Club.</strong></p>
        <p>Come build the next one with us.</p>
        <div className="club-nudge-actions">
          <a href={brand.clubSignUpFormUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Sign-up form</a>
          <a href={brand.clubInterestFormUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Interest form</a>
        </div>
      </div>
      <button className="club-nudge-close" type="button" aria-label="Dismiss club invitation" onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></button>
    </aside>
  )
}
