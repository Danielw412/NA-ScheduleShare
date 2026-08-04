import { notifyPredictionReady } from './notifier.js'
import { createPredictionFunction, developmentPlaceholderAllowed } from './prediction-engine.js'
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
  const predict = createPredictionFunction({
    allowDevelopmentPlaceholder: developmentPlaceholderAllowed(
      url,
      process.env.SCHEDULE_ENGINE_ENABLE_PLACEHOLDER,
      process.env.NODE_ENV,
    ),
  })
  const options = { store, workerId, predict, notify: notifyPredictionReady }

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
