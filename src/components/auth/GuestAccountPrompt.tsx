import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { clearAuthDestination, safeAuthDestination } from '../../lib/authDestination'
import { AuthForm } from './AuthForm'

interface GuestAccountPromptContextValue {
  openAccountPrompt: (next?: string) => void
  openSignInPrompt: (next?: string) => void
}

const GuestAccountPromptContext = createContext<GuestAccountPromptContextValue>({
  openAccountPrompt: () => undefined,
  openSignInPrompt: () => undefined,
})

export function GuestAccountPromptProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState<{ open: boolean; next: string; mode: 'sign-in' | 'sign-up' }>({ open: false, next: '/schedule', mode: 'sign-up' })
  const openAccountPrompt = useCallback((next = '/schedule') => setPrompt({ open: true, next: safeAuthDestination(next), mode: 'sign-up' }), [])
  const openSignInPrompt = useCallback((next = '/schedule') => setPrompt({ open: true, next: safeAuthDestination(next), mode: 'sign-in' }), [])
  const closeAccountPrompt = useCallback(() => setPrompt((current) => ({ ...current, open: false })), [])
  const value = useMemo(() => ({ openAccountPrompt, openSignInPrompt }), [openAccountPrompt, openSignInPrompt])

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
            <div id="account-dialog-title" className="sr-only">{prompt.mode === 'sign-in' ? 'Sign in' : 'Create an account'}</div>
            <AuthForm key={prompt.mode} initialMode={prompt.mode} next={prompt.next} />
          </section>
        </div>
      ) : null}
    </GuestAccountPromptContext.Provider>
  )
}

export function useGuestAccountPrompt() {
  return useContext(GuestAccountPromptContext)
}
