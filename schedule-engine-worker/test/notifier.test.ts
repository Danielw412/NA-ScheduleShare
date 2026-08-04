import { describe, expect, it, vi } from 'vitest'
import { createPredictionReadyNotifier, smtpConfigured } from '../src/notifier.js'
import { workerInput } from './fixtures.js'

const outcome = { results: [{ schedule: [], collateral_change_count: 0, search_stage: 'direct_replacement' as const, explanations: [] }], no_valid_schedule_reason: null }

describe('Schedule Engine SMTP notifier', () => {
  it('requires a complete local SMTP configuration', () => {
    expect(smtpConfigured({ host: 'smtp.example.com', port: 587, from: 'ScheduleShare <noreply@example.com>' })).toBe(true)
    expect(smtpConfigured({ host: 'smtp.example.com', port: 587 })).toBe(false)
    expect(smtpConfigured({ host: 'smtp.example.com', port: 587, from: 'noreply@example.com', user: 'user' })).toBe(false)
  })

  it('sends the completion link to the requesting user', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-1' })
    const notify = createPredictionReadyNotifier({ host: 'smtp.example.com', port: 587, from: 'ScheduleShare <noreply@example.com>', appUrl: 'https://example.com/#/schedule-engine' }, { sendMail } as never)
    await expect(notify(workerInput, outcome)).resolves.toEqual({ status: 'sent' })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: workerInput.user.email, subject: 'Your Schedule Engine predictions are ready' }))
  })

  it('does not invent delivery when SMTP is unavailable', async () => {
    const notify = createPredictionReadyNotifier({})
    await expect(notify(workerInput, outcome)).resolves.toEqual({ status: 'not_configured' })
  })

  it('does not claim predictions exist when the completed outcome has no valid schedule', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-2' })
    const notify = createPredictionReadyNotifier({ host: 'smtp.example.com', port: 587, from: 'noreply@example.com' }, { sendMail } as never)
    await notify(workerInput, { results: [], no_valid_schedule_reason: 'No existing sections fit.' })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Your Schedule Engine request is ready',
      text: expect.stringContaining('could not build a valid schedule'),
    }))
  })
})
