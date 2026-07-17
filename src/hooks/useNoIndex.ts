import { useEffect } from 'react'

export function useNoIndex(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const meta = existing ?? document.createElement('meta')
    const previousContent = existing?.content
    meta.name = 'robots'
    meta.content = 'noindex, nofollow, noarchive'
    if (!existing) document.head.append(meta)
    return () => {
      if (existing) existing.content = previousContent ?? ''
      else meta.remove()
    }
  }, [enabled])
}
