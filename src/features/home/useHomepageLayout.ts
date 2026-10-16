import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { HomepageLayout } from '../../lib/domain'
import { getHomepageLayout } from '../../lib/supabase/data'

const STORAGE_KEY = 'scheduleshare.homepage-layout'
const listeners = new Set<() => void>()
// undefined = not read from storage yet; null = nothing known (first visit).
let current: HomepageLayout | null | undefined

let request: Promise<void> | null = null

function readStored(): HomepageLayout | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'bell_schedule' || value === 'balanced' ? value : null
  } catch {
    return null
  }
}

function publish(layout: HomepageLayout) {
  current = layout
  try {
    window.localStorage.setItem(STORAGE_KEY, layout)
  } catch {
    // Storage is optional; the layout still applies for this visit.
  }
  listeners.forEach((listener) => listener())
}

function snapshot(): HomepageLayout | null {
  if (current === undefined) current = readStored()
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Apply an administrator's change immediately in this browser. */
export function setHomepageLayoutCache(layout: HomepageLayout) {
  publish(layout)
}

/** Test hook: forget the in-memory layout and any in-flight request. */
export function resetHomepageLayoutCache() {
  current = undefined
  request = null
}

/**
 * The administrator-selected homepage layout. The last known value renders
 * immediately (no layout jump on return visits) while the server value
 * refreshes once per page load. `null` means the first visit is still loading.
 */
export function useHomepageLayout(): HomepageLayout | null {
  const { isDemo } = useAuth()
  const layout = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    if (isDemo) {
      if (snapshot() === null) publish('balanced')
      return
    }
    if (request) return
    request = getHomepageLayout()
      .then(publish)
      .catch(() => { if (snapshot() === null) publish('balanced') })
  }, [isDemo])

  return layout
}
