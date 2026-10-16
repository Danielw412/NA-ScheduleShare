import { addBreadcrumb, captureMessage } from './client'
import { hashString } from './fingerprint'
import { routeTemplate } from './scrub'

/** "/rest/v1/rpc/get_my_schedule" — path only; query strings can hold filters and ids. */
export function requestOperation(url: string): string {
  try {
    return routeTemplate(new URL(url).pathname)
  } catch {
    return 'unknown'
  }
}

/**
 * Wraps fetch so every Supabase request leaves a breadcrumb (method, path,
 * status, duration — never bodies or headers) and server-side failures (5xx)
 * become warning-level issues grouped by operation and status.
 */
export function instrumentFetch(baseFetch: typeof fetch, ignore: RegExp = /\/rpc\/report_app_issue$/): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const operation = requestOperation(url)
    if (ignore.test(operation)) return baseFetch(input, init)
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
    try {
      const response = await baseFetch(input, init)
      const status = response.status
      addBreadcrumb({
        category: 'http',
        message: `${method} ${operation}`,
        level: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
        data: { status, duration_ms: elapsed() },
      })
      if (status >= 500) {
        captureMessage(`Supabase ${operation} responded with ${status}`, 'warning', {
          fingerprint: `web-http-${hashString(`${operation}|${status}`)}`,
          tags: { operation, status: String(status) },
        })
      }
      return response
    } catch (error) {
      addBreadcrumb({
        category: 'http',
        message: `${method} ${operation} failed`,
        level: 'warning',
        data: { duration_ms: elapsed(), error: error instanceof Error ? error.name : 'unknown' },
      })
      throw error
    }
  }
}
