import type { NotificationDelivery, PredictionOutcome, ScheduleEngineInput } from './types.js'
import nodemailer, { type Transporter } from 'nodemailer'

export type PredictionReadyNotifier = (input: ScheduleEngineInput, outcome: PredictionOutcome) => Promise<NotificationDelivery>

export interface SmtpNotifierConfig {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  password?: string
  from?: string
  appUrl?: string
}

export function smtpNotifierConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): SmtpNotifierConfig {
  return {
    host: environment.SMTP_HOST?.trim(),
    port: Number(environment.SMTP_PORT || 587),
    secure: environment.SMTP_SECURE?.toLowerCase() === 'true',
    user: environment.SMTP_USER?.trim(),
    password: environment.SMTP_PASSWORD,
    from: environment.SMTP_FROM?.trim(),
    appUrl: environment.SCHEDULE_ENGINE_APP_URL?.trim() || 'https://schedule.naclubs.net/#/schedule-engine',
  }
}

export function smtpConfigured(config: SmtpNotifierConfig): boolean {
  return Boolean(config.host && config.port && config.from && ((!config.user && !config.password) || (config.user && config.password)))
}

export function createPredictionReadyNotifier(config: SmtpNotifierConfig, providedTransport?: Transporter): PredictionReadyNotifier {
  if (!smtpConfigured(config)) return async () => ({ status: 'not_configured' })
  const transport = providedTransport ?? nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  })
  return async (input, outcome) => {
    if (!input.user.email) return { status: 'failed', errorMessage: 'The requesting user does not have an email address.' }
    try {
      const hasResults = outcome.results.length > 0
      await transport.sendMail({
        from: config.from,
        to: input.user.email,
        subject: hasResults ? 'Your Schedule Engine predictions are ready' : 'Your Schedule Engine request is ready',
        text: `${hasResults ? 'Your predicted schedules are ready.' : 'Schedule Engine could not build a valid schedule from the existing sections.'} View the details in ScheduleShare: ${config.appUrl}`,
        html: `<p>${hasResults ? 'Your predicted schedules are ready.' : 'Schedule Engine could not build a valid schedule from the existing sections.'}</p><p><a href="${config.appUrl}">View the details in ScheduleShare</a></p><p>Predictions are estimates and may not match the schedule produced by the school.</p>`,
      })
      return { status: 'sent' }
    } catch {
      return { status: 'failed', errorMessage: 'The email provider did not accept the notification.' }
    }
  }
}

export const notifyPredictionReady = createPredictionReadyNotifier(smtpNotifierConfigFromEnvironment())
