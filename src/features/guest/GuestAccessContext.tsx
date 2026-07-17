import { createContext, useContext } from 'react'

interface GuestAccessContextValue {
  explorationEnabled: boolean
}

export const GuestAccessContext = createContext<GuestAccessContextValue>({
  explorationEnabled: true,
})

export function useGuestAccess() {
  return useContext(GuestAccessContext)
}
