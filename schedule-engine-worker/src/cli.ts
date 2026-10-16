import { createPredictionReadyNotifier, smtpNotifierConfigFromEnvironment } from './notifier.js'
import { maxCollateralChangesFromEnvironment } from './prediction-engine.js'
import { createSchedulePolicyPredictionFunction } from './schedule-policy.js'
import { createWorkerLogger, errorSummary, workerIssueEvent, type WorkerFailureReporter } from './observability.js'
import { createScheduleEngineStore } from './supabase-store.js'
import { processFullQueue, processNextJob } from './worker.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function main() {
  const mode = process.argv[2]
  if (mode !== '--once' && mode !== '--queue') throw new Error('Use --once to process one job or --queue to process the full queue.')
  const url = requiredEnvironment('SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  const workerId = process.env.SCHEDULE_ENGINE_WORKER_ID?.trim() || `laptop-${crypto.randomUUID()}`
  const store = createScheduleEngineStore(url, serviceRoleKey)
  const maxCollateralChanges = maxCollateralChangesFromEnvironment(process.env.SCHEDULE_ENGINE_MAX_COLLATERAL_CHANGES)
  const predict = createSchedulePolicyPredictionFunction({
    maxCollateralChanges,
  })
  const logger = createWorkerLogger({ format: process.env.SCHEDULE_ENGINE_LOG_FORMAT, workerId })
  const onFailure: WorkerFailureReporter = async (error, context) => {
    logger.error('job_failed', { job_id: context.jobId, stage: context.stage, ...errorSummary(error) })
    await store.reportIssue(workerIssueEvent(error, { ...context, workerId, release: process.env.APP_RELEASE?.trim() }))
  }
  const options = { store, workerId, predict, notify: createPredictionReadyNotifier(smtpNotifierConfigFromEnvironment()), onFailure }

  if (mode === '--once') {
    const outcome = await processNextJob(options)
    console.log(`Schedule Engine worker: ${outcome}.`)
    if (outcome === 'failed') process.exitCode = 1
    return
  }

  const summary = await processFullQueue(options)
  console.log(`Schedule Engine queue complete: ${summary.completed} completed, ${summary.failed} failed.`)
  if (summary.failed > 0) process.exitCode = 1
}

void main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : 'Schedule Engine worker failed to start.')
  process.exitCode = 1
})
