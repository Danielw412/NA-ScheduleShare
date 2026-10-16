import { initObservability } from './client'
import { installGlobalHandlers } from './globalHandlers'
import { consoleTransport } from './transports/console'
import { createDatabaseTransport, type IssueReportPayload } from './transports/database'
import type { Transport } from './types'

export interface ObservabilitySetup {
  /** Sends a report to the first-party issue store; omit when Supabase is unavailable (demo mode). */
  reportIssue?: (payload: IssueReportPayload) => Promise<void>
  /** Extra transports, e.g. createSentryTransport(Sentry) once the SDK is installed. */
  transports?: Transport[]
}

/**
 * Wire up error capture for the browser app. Configuration comes from build
 * environment variables (see .env.example and docs/observability.md):
 *   VITE_APP_RELEASE        release identifier, set to the commit SHA by CI
 *   VITE_ISSUE_REPORTING    "off" disables the first-party issue store
 */
export function setupObservability({ reportIssue, transports = [] }: ObservabilitySetup = {}) {
  const env = import.meta.env
  const issueReporting = env.VITE_ISSUE_REPORTING?.trim().toLowerCase() !== 'off'
  const active: Transport[] = []
  if (env.DEV) active.push(consoleTransport)
  if (issueReporting && reportIssue && env.PROD) active.push(createDatabaseTransport(reportIssue))
  active.push(...transports)

  initObservability({
    release: env.VITE_APP_RELEASE?.trim() || (env.DEV ? 'development' : 'unversioned'),
    environment: env.MODE,
    transports: active,
  })
  installGlobalHandlers()
}
