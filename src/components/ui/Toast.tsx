import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastTone = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined })
const TOAST_DURATION_MS = 4200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current
    setToasts((current) => [...current.slice(-2), { id, message, tone }])
    timers.current.set(id, window.setTimeout(() => dismiss(id), TOAST_DURATION_MS))
  }, [dismiss])

  useEffect(() => {
    const activeTimers = timers.current
    return () => activeTimers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = toast.tone === 'error' ? AlertCircle : CheckCircle2
          return (
            <div className={toast.tone === 'error' ? 'toast is-error' : 'toast'} key={toast.id}>
              <Icon aria-hidden="true" />
              <p>{toast.message}</p>
              <button className="icon-button" type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}><X aria-hidden="true" /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
