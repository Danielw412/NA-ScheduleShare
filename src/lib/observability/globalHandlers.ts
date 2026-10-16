import { addBreadcrumb, captureException } from './client'

let installed = false

/** Report uncaught errors and unhandled promise rejections, and note connectivity changes. */
export function installGlobalHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event: ErrorEvent) => {
    // Resource load failures (img/script tags) bubble as plain Events; skip them.
    if (!(event instanceof ErrorEvent)) return
    captureException(event.error ?? event.message, { mechanism: 'onerror', handled: false })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    captureException(event.reason, { mechanism: 'onunhandledrejection', handled: false })
  })

  window.addEventListener('online', () => addBreadcrumb({ category: 'network', message: 'Browser went online' }))
  window.addEventListener('offline', () => addBreadcrumb({ category: 'network', message: 'Browser went offline', level: 'warning' }))

  // Vite fires this when a lazily loaded route's files are gone after a deploy.
  window.addEventListener('vite:preloadError', () => addBreadcrumb({ category: 'navigation', message: 'Route files failed to preload', level: 'warning' }))
}

/** True when a lazily loaded chunk could not be fetched — usually a stale tab after a deploy. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|Loading chunk \S+ failed/i.test(message)
}
