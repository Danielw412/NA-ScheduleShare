import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useNow } from '../../hooks/useNow'
import { demoBellScheduleWindow, easternDateKey } from '../../lib/bellSchedule'
import type { BellCampus, SchoolDayContext } from '../../lib/domain'
import { getGuestBellScheduleWindow, getMyBellScheduleWindow } from '../../lib/supabase/data'

export const BELL_WINDOW_DAYS = 21
const GUEST_CAMPUS_KEY = 'scheduleshare.bell-campus'

export interface BellScheduleContextValue {
  days: SchoolDayContext[]
  status: 'loading' | 'ready' | 'error'
  /** Campus of the loaded calendar. */
  campus: BellCampus
  /** Guests pick a campus; signed-in students get the one matching their grade. */
  canChooseCampus: boolean
  setGuestCampus: (campus: BellCampus) => void
  retry: () => void
}

const BellScheduleContext = createContext<BellScheduleContextValue | null>(null)

function storedGuestCampus(): BellCampus {
  try {
    return window.localStorage.getItem(GUEST_CAMPUS_KEY) === 'NAI' ? 'NAI' : 'NASH'
  } catch {
    return 'NASH'
  }
}

export function campusForGrade(grade: number | null | undefined): BellCampus {
  return grade && grade <= 10 ? 'NAI' : 'NASH'
}

/**
 * Loads the bounded bell-schedule window once for the whole app so the shell,
 * Today, and Bell schedule screens agree on the same calendar.
 */
export function BellScheduleProvider({ children }: { children: ReactNode }) {
  const { user, profile, isDemo, loading: authLoading } = useAuth()
  const minuteNow = useNow(60_000)
  const startDate = easternDateKey(minuteNow)
  const [guestCampus, setGuestCampusState] = useState<BellCampus>(storedGuestCampus)
  const [days, setDays] = useState<SchoolDayContext[]>([])
  const [status, setStatus] = useState<BellScheduleContextValue['status']>('loading')
  const [attempt, setAttempt] = useState(0)
  const userId = user?.id ?? null
  const profileCampus = campusForGrade(profile?.grade)
  const requestedCampus = userId ? profileCampus : guestCampus
  // Signed-in students get their campus from the server, so a profile load
  // must not trigger a second request.
  const sourceKey = isDemo ? `demo:${requestedCampus}` : userId ? `user:${userId}` : `guest:${requestedCampus}`
  const [loadedSourceKey, setLoadedSourceKey] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    let active = true
    const [source, campusOrUser] = sourceKey.split(':') as ['demo' | 'user' | 'guest', string]
    const request = source === 'demo'
      ? Promise.resolve(demoBellScheduleWindow(startDate, BELL_WINDOW_DAYS, campusOrUser as BellCampus))
      : source === 'user'
        ? getMyBellScheduleWindow(startDate, BELL_WINDOW_DAYS)
        : getGuestBellScheduleWindow(startDate, BELL_WINDOW_DAYS, campusOrUser as BellCampus)
    void request.then((value) => {
      if (!active) return
      setDays(value)
      setLoadedSourceKey(sourceKey)
      setStatus('ready')
    }).catch(() => {
      if (!active) return
      setStatus('error')
    })
    return () => { active = false }
  }, [attempt, authLoading, sourceKey, startDate])

  // A new source (sign-in, campus switch) shows loading; a date rollover or
  // retry keeps the current calendar on screen while it refreshes.
  const effectiveStatus = status === 'ready' && loadedSourceKey !== sourceKey ? 'loading' : status

  const setGuestCampus = useCallback((campus: BellCampus) => {
    setGuestCampusState(campus)
    try {
      window.localStorage.setItem(GUEST_CAMPUS_KEY, campus)
    } catch {
      // Storage can be unavailable in private browsing; the choice still applies for this visit.
    }
  }, [])
  const retry = useCallback(() => {
    setStatus('loading')
    setAttempt((value) => value + 1)
  }, [])

  const value = useMemo<BellScheduleContextValue>(() => ({
    days: loadedSourceKey === sourceKey ? days : [],
    status: effectiveStatus,
    campus: loadedSourceKey === sourceKey ? days[0]?.campus ?? requestedCampus : requestedCampus,
    canChooseCampus: !userId,
    setGuestCampus,
    retry,
  }), [days, effectiveStatus, loadedSourceKey, requestedCampus, retry, setGuestCampus, sourceKey, userId])

  return <BellScheduleContext.Provider value={value}>{children}</BellScheduleContext.Provider>
}

export function useBellSchedule(): BellScheduleContextValue {
  const value = useContext(BellScheduleContext)
  if (!value) throw new Error('useBellSchedule must be used inside BellScheduleProvider')
  return value
}
