import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility'
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
  const headingId = useId()
  const [prompt, setPrompt] = useState<{ open: boolean; next: string; mode: 'sign-in' | 'sign-up' }>({ open: false, next: '/schedule', mode: 'sign-up' })
  const openAccountPrompt = useCallback((next = '/schedule') => setPrompt({ open: true, next: safeAuthDestination(next), mode: 'sign-up' }), [])
  const openSignInPrompt = useCallback((next = '/schedule') => setPrompt({ open: true, next: safeAuthDestination(next), mode: 'sign-in' }), [])
  const closeAccountPrompt = useCallback(() => setPrompt((current) => ({ ...current, open: false })), [])
  const value = useMemo(() => ({ openAccountPrompt, openSignInPrompt }), [openAccountPrompt, openSignInPrompt])
  const dialogRef = useDialogAccessibility(prompt.open && !user, closeAccountPrompt)

  useEffect(() => {
    if (!user || !prompt.open) return
    closeAccountPrompt()
    clearAuthDestination()
    void navigate(prompt.next, { replace: true })
  }, [closeAccountPrompt, navigate, prompt.next, prompt.open, user])

  return (
    <GuestAccountPromptContext.Provider value={value}>
      {children}
      {prompt.open && !user ? createPortal(
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAccountPrompt() }}>
          {/* Named by the form's visible heading, which follows sign in, create account, and reset. */}
          <section className="dialog is-small auth-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
            <span className="sheet-handle" aria-hidden="true" />
            <button className="icon-button auth-dialog-close" type="button" aria-label="Close account dialog" onClick={closeAccountPrompt}><X aria-hidden="true" /></button>
            <div className="dialog-body auth-dialog-body">
              <AuthForm key={prompt.mode} initialMode={prompt.mode} next={prompt.next} headingId={headingId} />
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </GuestAccountPromptContext.Provider>
  )
}

export function useGuestAccountPrompt() {
  return useContext(GuestAccountPromptContext)
}
