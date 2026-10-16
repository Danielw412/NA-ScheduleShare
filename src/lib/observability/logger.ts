import { addBreadcrumb, captureException, captureMessage } from './client'
import type { CaptureContext } from './types'

/**
 * Structured application logging. Every call leaves a breadcrumb so the
 * events leading up to a problem travel with its report; errors also create
 * an issue. Console output appears in development only, except warnings and
 * errors, which always reach the console.
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  /** Logs and reports. Pass the caught value as `error` to keep its stack. */
  error(message: string, error?: unknown, context?: CaptureContext): string | null
}

const isDevelopment = import.meta.env.DEV

export function createLogger(scope: string): Logger {
  const category = `log.${scope}`
  return {
    debug(message, data) {
      if (isDevelopment) console.debug(`[${scope}] ${message}`, data ?? '')
      addBreadcrumb({ category, message, level: 'debug', data })
    },
    info(message, data) {
      if (isDevelopment) console.info(`[${scope}] ${message}`, data ?? '')
      addBreadcrumb({ category, message, level: 'info', data })
    },
    warn(message, data) {
      console.warn(`[${scope}] ${message}`, data ?? '')
      addBreadcrumb({ category, message, level: 'warning', data })
    },
    error(message, error, context) {
      console.error(`[${scope}] ${message}`, error ?? '')
      addBreadcrumb({ category, message, level: 'error' })
      const tags = { scope, ...context?.tags }
      return error === undefined
        ? captureMessage(message, context?.level ?? 'error', { ...context, tags })
        : captureException(error, { ...context, tags, extra: { log_message: message, ...context?.extra } })
    },
  }
}

export const logger = createLogger('app')
