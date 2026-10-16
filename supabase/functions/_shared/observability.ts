/**
 * Structured logging and issue reporting for Supabase Edge Functions.
 *
 * - Every request logs one JSON line with function, request id, method,
 *   status, and duration. Supabase's log explorer indexes JSON fields.
 * - Unexpected exceptions (including async rejections, which a bare
 *   `try { return handler() }` does not catch) are logged, reported to the
 *   first-party issue store through `service_report_app_issue`, and answered
 *   with the function's own "unavailable" response.
 * - Log fields are scrubbed: no tokens, emails, prompts, images, or bodies.
 *
 * See docs/observability.md. Kept dependency-free so it runs in Deno and in
 * the Vitest suites that exercise each function's core.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface FunctionLogger {
  readonly requestId: string
  readonly functionName: string
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface ServerIssueEvent {
  event_id: string
  fingerprint: string
  level: 'warning' | 'error' | 'fatal'
  message: string
  culprit: string
  exception_type: string
  stacktrace: Array<{ function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }>
  breadcrumbs: never[]
  tags: Record<string, string>
  context: Record<string, unknown>
}

export type IssueReporter = (event: ServerIssueEvent) => Promise<void>

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|e-?mail|full[-_]?name|image|screenshot|prompt|response|body|signed[-_]?url/i

export function scrubText(value: string, maxLength = 500): string {
  const scrubbed = value
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[token]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b(apikey|api_key|access_token|refresh_token|token|key|password)=([^&\s#]+)/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength - 1)}…` : scrubbed
}

export function scrubFields(fields: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields).slice(0, 40)) {
    if (SENSITIVE_KEY.test(key)) output[key] = '[redacted]'
    else if (typeof value === 'string') output[key] = scrubText(value)
    else if (value && typeof value === 'object' && !Array.isArray(value) && depth < 3) output[key] = scrubFields(value as Record<string, unknown>, depth + 1)
    else if (Array.isArray(value)) output[key] = value.slice(0, 20).map((item) => (typeof item === 'string' ? scrubText(item) : item))
    else output[key] = value
  }
  return output
}

export function createFunctionLogger(functionName: string, requestId: string, write: (line: string) => void = (line) => console.log(line)): FunctionLogger {
  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    write(JSON.stringify({
      level,
      event,
      function: functionName,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      ...scrubFields(fields),
    }))
  }
  return {
    requestId,
    functionName,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: scrubText(error.message, 300),
      error_stack: error.stack?.split('\n').slice(1, 6).map((line) => scrubText(line.trim(), 200)),
    }
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      error_name: typeof record.name === 'string' ? record.name : 'NonErrorThrown',
      error_message: scrubText(typeof record.message === 'string' ? record.message : 'Unknown error', 300),
      error_code: typeof record.code === 'string' ? record.code : undefined,
    }
  }
  return { error_name: 'NonErrorThrown', error_message: scrubText(String(error), 300) }
}

/** cyrb53, identical to the browser implementation, for stable fingerprints. */
export function hashString(value: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function parseFrames(stack: string | undefined): ServerIssueEvent['stacktrace'] {
  if (!stack) return []
  const frames: ServerIssueEvent['stacktrace'] = []
  for (const line of stack.split('\n').slice(1)) {
    const match = /^\s*at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!match) continue
    const filename = match[2].replace(/^file:\/\/.*?\/functions\//, 'functions/')
    frames.push({ function: match[1] || undefined, filename: scrubText(filename, 200), lineno: Number(match[3]), colno: Number(match[4]), in_app: !/deno\.land|esm\.sh|npm:|jsr:|ext:/.test(filename) })
    if (frames.length >= 30) break
  }
  return frames
}

export function serverIssueEvent(functionName: string, requestId: string, error: unknown, release?: string): ServerIssueEvent {
  const fields = errorFields(error)
  const type = String(fields.error_name ?? 'Error')
  const message = String(fields.error_message ?? 'Unknown error')
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    fingerprint: `fn-${hashString(`${functionName}|${type}|${normalizeMessage(message)}`)}`,
    level: 'error',
    message: `${type}: ${message}`.slice(0, 500),
    culprit: functionName,
    exception_type: type.slice(0, 120),
    stacktrace: error instanceof Error ? parseFrames(error.stack) : [],
    breadcrumbs: [],
    tags: { function: functionName, runtime: 'deno' },
    context: { function: functionName, request_id: requestId, release: release?.slice(0, 64), environment: 'production' },
  }
}

export interface ObservedHandlerOptions {
  functionName: string
  /** The function's own "temporarily unavailable" response, used when it crashes. */
  unavailable: () => Response
  reportIssue?: IssueReporter
  release?: string
  write?: (line: string) => void
}

const REPORT_TIMEOUT_MS = 1500

/** Wrap a function's fetch handler with request logging and crash reporting. */
export function observeHandler(
  handler: (request: Request, logger: FunctionLogger) => Promise<Response> | Response,
  options: ObservedHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = request.headers.get('x-request-id')?.slice(0, 100) || crypto.randomUUID()
    const logger = createFunctionLogger(options.functionName, requestId, options.write)
    const started = Date.now()
    const method = request.method
    try {
      const response = await handler(request, logger)
      const fields = { method, status: response.status, duration_ms: Date.now() - started }
      if (response.status >= 500) logger.warn('request_returned_server_error', fields)
      else logger.info('request_completed', fields)
      return response
    } catch (error) {
      logger.error('request_failed', { method, duration_ms: Date.now() - started, ...errorFields(error) })
      if (options.reportIssue) {
        const event = serverIssueEvent(options.functionName, requestId, error, options.release)
        await Promise.race([
          options.reportIssue(event).catch((reportError) => logger.warn('issue_report_failed', errorFields(reportError))),
          new Promise((resolve) => setTimeout(resolve, REPORT_TIMEOUT_MS)),
        ])
      }
      return options.unavailable()
    }
  }
}

type RpcCall = (functionName: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>

/**
 * Issue reporter backed by a service-role Supabase client's `rpc` method, so
 * each function keeps using its own client and key format.
 */
export function rpcIssueReporter(rpc: RpcCall | null, source: 'edge_function' | 'schedule_engine' = 'edge_function'): IssueReporter | undefined {
  if (!rpc) return undefined
  return async (event) => {
    const { error } = await rpc('service_report_app_issue', { p_event: event, p_source: source })
    if (error) throw error
  }
}
