/**
 * Privacy scrubbing applied to every event before it leaves the browser.
 * ScheduleShare's users are high-school students: events may carry an opaque
 * account id, but never names, emails, tokens, share links, or screenshots.
 */

const REDACTED = '[redacted]'
const MAX_STRING = 500
const MAX_ARRAY = 20
const MAX_KEYS = 30
const MAX_DEPTH = 4

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|session|e-?mail|full[-_]?name|first[-_]?name|last[-_]?name|display[-_]?name|owner[-_]?name|student[-_]?name|phone|image|screenshot|photo|avatar|prompt|response|signed[-_]?url|share[-_]?url/i

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function scrubText(value: string, maxLength = MAX_STRING): string {
  const scrubbed = value
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[token]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b(apikey|api_key|access_token|refresh_token|token|code|key|password)=([^&\s#]+)/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\/share\/[^/\s?#"']+/gi, '/share/[token]')
    .replace(/\b\d{9,}\b/g, '[number]')
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength - 1)}…` : scrubbed
}

/** Route template for grouping and display: ids and tokens become placeholders. */
export function routeTemplate(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] || '/'
  return withoutQuery
    .replace(/^\/share\/[^/]+/i, '/share/:token')
    .replace(UUID, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
}

/** Current hash-router route, scrubbed. */
export function currentRoute(): string {
  if (typeof window === 'undefined') return '/'
  const hashRoute = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/'
  return routeTemplate(hashRoute)
}

export function scrubData(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) }
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => scrubData(item, depth + 1))
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubData(item, depth + 1)
    }
    return output
  }
  return String(value)
}

export function scrubRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return (scrubData(value ?? {}) as Record<string, unknown>) ?? {}
}
