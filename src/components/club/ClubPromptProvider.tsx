import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ClubJoinDialog } from './ClubJoinDialog'
import { ClubVisitNudge } from './ClubVisitNudge'

interface ClubPromptContextValue {
  openClubDialog: () => void
}

const ClubPromptContext = createContext<ClubPromptContextValue>({ openClubDialog: () => undefined })

export function ClubPromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openClubDialog = useCallback(() => setOpen(true), [])
  const closeClubDialog = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ openClubDialog }), [openClubDialog])

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
