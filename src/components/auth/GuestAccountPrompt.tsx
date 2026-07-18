import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { clearAuthDestination } from '../../lib/authDestination'
import { AuthForm } from './AuthForm'

interface GuestAccountPromptContextValue {
  openAccountPrompt: (next?: string) => void
}

const GuestAccountPromptContext = createContext<GuestAccountPromptContextValue>({ openAccountPrompt: () => undefined })

export function GuestAccountPromptProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState({ open: false, next: '/schedule' })
  const openAccountPrompt = useCallback((next = '/schedule') => setPrompt({ open: true, next }), [])
  const closeAccountPrompt = useCallback(() => setPrompt((current) => ({ ...current, open: false })), [])
  const value = useMemo(() => ({ openAccountPrompt }), [openAccountPrompt])

  useEffect(() => {
    if (!user || !prompt.open) return
    closeAccountPrompt()
    clearAuthDestination()
    void navigate(prompt.next, { replace: true })
  }, [closeAccountPrompt, navigate, prompt.next, prompt.open, user])

  return (
    <GuestAccountPromptContext.Provider value={value}>
      {children}
      {prompt.open && !user ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
            <button className="icon-button" type="button" aria-label="Close account dialog" onClick={closeAccountPrompt}><X aria-hidden="true" /></button>
            <div id="account-dialog-title" className="sr-only">Create an account</div>
            <AuthForm initialMode="sign-up" next={prompt.next} />
          </section>
        </div>
      ) : null}
    </GuestAccountPromptContext.Provider>
  )
}

export function useGuestAccountPrompt() {
  return useContext(GuestAccountPromptContext)
}
