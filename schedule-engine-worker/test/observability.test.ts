import { describe, expect, it, vi } from 'vitest'
import { createWorkerLogger, workerIssueEvent } from '../src/observability.js'
import type { PredictionReadyNotifier } from '../src/notifier.js'
import type { ScheduleEngineStore } from '../src/types.js'
import { processNextJob } from '../src/worker.js'
import { workerInput } from './fixtures.js'

function storeMock(): ScheduleEngineStore {
  return {
    listJobs: vi.fn(),
    claimNext: vi.fn().mockResolvedValue({ jobId: 'job-1', userId: 'user-1', emailNotification: true, attemptCount: 1, claimedAt: '2026-08-01T12:01:00Z' }),
    getWorkerInput: vi.fn().mockResolvedValue(workerInput),
    complete: vi.fn(),
    fail: vi.fn(),
    recordNotification: vi.fn(),
  }
}

describe('Schedule Engine worker observability', () => {
  it('reports a failed prediction before marking the job failed', async () => {
    const store = storeMock()
    const onFailure = vi.fn().mockResolvedValue(undefined)
    const crash = new TypeError('Cannot read properties of undefined')
    const outcome = await processNextJob({ store, workerId: 'w', predict: vi.fn().mockRejectedValue(crash), notify: vi.fn() as unknown as PredictionReadyNotifier, onFailure })
    expect(outcome).toBe('failed')
    expect(onFailure).toHaveBeenCalledWith(crash, { jobId: 'job-1', stage: 'prediction' })
    expect(store.fail).toHaveBeenCalledWith('job-1', 'w', expect.any(String))
  })

  it('keeps the job outcome when reporting itself fails', async () => {
    const store = storeMock()
    const outcome = await processNextJob({
      store, workerId: 'w', predict: vi.fn().mockRejectedValue(new Error('boom')), notify: vi.fn() as unknown as PredictionReadyNotifier,
      onFailure: vi.fn().mockRejectedValue(new Error('issue store down')),
    })
    expect(outcome).toBe('failed')
    expect(store.fail).toHaveBeenCalled()
  })

  it('reports notification failures as warnings without failing the completed job', async () => {
    const store = storeMock()
    const onFailure = vi.fn().mockResolvedValue(undefined)
    const outcome = await processNextJob({
      store, workerId: 'w',
      predict: vi.fn().mockResolvedValue({ results: [], no_valid_schedule_reason: 'No sections fit.' }),
      notify: vi.fn().mockRejectedValue(new Error('SMTP down')) as unknown as PredictionReadyNotifier,
      onFailure,
    })
    expect(outcome).toBe('completed')
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error), { jobId: 'job-1', stage: 'notification' })
    expect(workerIssueEvent(new Error('SMTP down'), { jobId: 'job-1', stage: 'notification' }).level).toBe('warning')
  })

  it('builds stable, scrubbed issue events', () => {
    const first = workerIssueEvent(new Error('Job 96200000-0000-4000-8000-000000000001 failed for jordan@example.com'), { jobId: 'job-1', stage: 'prediction', release: 'abc' })
    const second = workerIssueEvent(new Error('Job 96200000-0000-4000-8000-000000000002 failed for jordan@example.com'), { jobId: 'job-2', stage: 'prediction' })
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.fingerprint).toMatch(/^engine-[0-9a-f]{14}$/)
    expect(first.message).toContain('[email]')
    expect(first.context).toMatchObject({ job_id: 'job-1', release: 'abc' })
  })

  it('writes JSON or readable log lines', () => {
    const lines: string[] = []
    createWorkerLogger({ format: 'json', workerId: 'w', write: (line) => lines.push(line) }).error('job_failed', { job_id: 'job-1' })
    createWorkerLogger({ write: (line) => lines.push(line) }).info('queue_empty')
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'error', event: 'job_failed', worker_id: 'w', job_id: 'job-1' })
    expect(lines[1]).toMatch(/INFO {2}queue_empty$/)
  })
})
