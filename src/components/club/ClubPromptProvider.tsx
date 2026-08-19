import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { getWhyScheduleShareEnabled } from '../../lib/supabase/data'
import { ClubJoinDialog } from './ClubJoinDialog'
import { ClubVisitNudge } from './ClubVisitNudge'

interface ClubPromptContextValue {
  openClubDialog: () => void
  setWhyScheduleShareEnabled: (enabled: boolean) => void
  whyScheduleShareEnabled: boolean | null
}

const ClubPromptContext = createContext<ClubPromptContextValue>({
  openClubDialog: () => undefined,
  setWhyScheduleShareEnabled: () => undefined,
  whyScheduleShareEnabled: true,
})

export function ClubPromptProvider({ children }: { children: ReactNode }) {
  const { isDemo } = useAuth()
  const [open, setOpen] = useState(false)
  const [whyScheduleShareEnabled, setWhyScheduleShareEnabled] = useState<boolean | null>(null)
  const openClubDialog = useCallback(() => setOpen(true), [])
  const closeClubDialog = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (isDemo) {
      setWhyScheduleShareEnabled(true)
      return
    }
    let active = true
    setWhyScheduleShareEnabled(null)
    void getWhyScheduleShareEnabled()
      .then((enabled) => { if (active) setWhyScheduleShareEnabled(enabled) })
      .catch(() => { if (active) setWhyScheduleShareEnabled(false) })
    return () => { active = false }
  }, [isDemo])

  const value = useMemo(() => ({ openClubDialog, setWhyScheduleShareEnabled, whyScheduleShareEnabled }), [openClubDialog, whyScheduleShareEnabled])

  return (
    <ClubPromptContext.Provider value={value}>
      {children}
      <ClubJoinDialog open={open} onClose={closeClubDialog} />
      <ClubVisitNudge />
    </ClubPromptContext.Provider>
  )
}

export function useClubPrompt() {
  return useContext(ClubPromptContext)
}
