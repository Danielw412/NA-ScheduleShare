/**
 * Structured logging and issue reporting for the laptop-run Schedule Engine
 * worker. Log lines are JSON when SCHEDULE_ENGINE_LOG_FORMAT=json (for log
 * files), readable text otherwise. Failures are reported to the same
 * first-party issue store the website uses (docs/observability.md).
 */

export type WorkerLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface WorkerLogger {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface WorkerIssueEvent {
  event_id: string
  fingerprint: string
  level: 'warning' | 'error'
  message: string
  culprit: string
  exception_type: string
  stacktrace: Array<{ function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }>
  breadcrumbs: never[]
  tags: Record<string, string>
  context: Record<string, unknown>
}

/** Called when a job fails; must never throw into the worker loop. */
export type WorkerFailureReporter = (error: unknown, context: { jobId: string; stage: 'prediction' | 'notification' }) => Promise<void>

export function createWorkerLogger(options: { format?: string; write?: (line: string) => void; workerId?: string } = {}): WorkerLogger {
  const json = options.format === 'json'
  const write = options.write ?? ((line: string) => console.log(line))
  const emit = (level: WorkerLogLevel, event: string, fields: Record<string, unknown> = {}) => {
    if (json) {
      write(JSON.stringify({ level, event, worker_id: options.workerId, timestamp: new Date().toISOString(), ...fields }))
      return
    }
    const details = Object.entries(fields).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' ')
    write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${event}${details ? ` ${details}` : ''}`)
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

function hashString(value: string, seed = 0): string {
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

function scrub(value: string, maxLength = 300): string {
  const scrubbed = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[token]')
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength - 1)}…` : scrubbed
}

export function errorSummary(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: scrub(error.message) }
  return { name: 'NonErrorThrown', message: scrub(String(error)) }
}

export function workerIssueEvent(error: unknown, context: { jobId: string; stage: string; workerId?: string; release?: string }): WorkerIssueEvent {
  const { name, message } = errorSummary(error)
  const normalized = message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/\b\d+\b/g, '<n>')
  const frames = error instanceof Error && error.stack
    ? error.stack.split('\n').slice(1, 31).flatMap((line) => {
      const match = /^\s*at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line)
      if (!match) return []
      const filename = match[2].replace(/^.*\/schedule-engine-worker\//, 'schedule-engine-worker/')
      return [{ function: match[1] || undefined, filename, lineno: Number(match[3]), colno: Number(match[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') }]
    })
    : []
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    fingerprint: `engine-${hashString(`${context.stage}|${name}|${normalized}`)}`,
    level: context.stage === 'notification' ? 'warning' : 'error',
    message: `${name}: ${message}`.slice(0, 500),
    culprit: `schedule-engine ${context.stage}`,
    exception_type: name.slice(0, 120),
    stacktrace: frames,
    breadcrumbs: [],
    tags: { stage: context.stage, runtime: 'node' },
    context: { job_id: context.jobId, release: context.release?.slice(0, 64), environment: 'worker' },
  }
}
