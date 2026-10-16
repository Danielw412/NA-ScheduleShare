import { useEffect, useState } from 'react'

/**
 * The current time, refreshed on an interval while the tab is visible. The
 * timer stops in hidden tabs and recomputes immediately when the tab returns.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: number | null = null
    const tick = () => setNow(new Date())
    const start = () => {
      if (timer !== null || document.visibilityState === 'hidden') return
      timer = window.setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else {
        tick()
        start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
