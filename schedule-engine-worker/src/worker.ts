import type { PredictionReadyNotifier } from './notifier.js'
import type { PredictionFunction, ScheduleEngineInput, ScheduleEngineStore } from './types.js'

export type ProcessOutcome = 'empty' | 'completed' | 'failed'

function safeWorkerError(caught: unknown): string {
  if (caught instanceof Error && caught.message === 'Schedule prediction is not implemented yet.') return caught.message
  return 'Schedule Engine processing failed. The request can be tried again after the worker is updated.'
}

export async function processNextJob(options: {
  store: ScheduleEngineStore
  workerId: string
  predict: PredictionFunction
  notify: PredictionReadyNotifier
}): Promise<ProcessOutcome> {
  const claimed = await options.store.claimNext(options.workerId)
  if (!claimed) return 'empty'
  let input: ScheduleEngineInput
  try {
    input = await options.store.getWorkerInput(claimed.jobId, options.workerId)
    const results = await options.predict(input)
    if (results.length < 1 || results.length > 4) throw new Error('Prediction engine returned an invalid result count.')
    await options.store.complete(claimed.jobId, options.workerId, results)
  } catch (caught) {
    await options.store.fail(claimed.jobId, options.workerId, safeWorkerError(caught))
    return 'failed'
  }

  if (input.job.email_notification) {
    try {
      const delivery = await options.notify(input)
      if (delivery.status !== 'not_configured') await options.store.recordNotification(claimed.jobId, options.workerId, delivery)
    } catch {
      try {
        await options.store.recordNotification(claimed.jobId, options.workerId, {
          status: 'failed',
          errorMessage: 'Email notification failed after the prediction completed.',
        })
      } catch {
        // The prediction is already safely stored. Notification failures must not
        // turn a completed Schedule Engine job into a failed prediction job.
      }
    }
  }
  return 'completed'
}

export async function processFullQueue(options: {
  store: ScheduleEngineStore
  workerId: string
  predict: PredictionFunction
  notify: PredictionReadyNotifier
}): Promise<{ completed: number; failed: number }> {
  let completed = 0
  let failed = 0
  while (true) {
    const outcome = await processNextJob(options)
    if (outcome === 'empty') return { completed, failed }
    if (outcome === 'completed') completed += 1
    else failed += 1
  }
}
