import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PredictionReadyNotifier } from '../src/notifier.js'
import type { PredictionFunction, ScheduleEngineStore } from '../src/types.js'
import { processFullQueue, processNextJob } from '../src/worker.js'
import { workerInput } from './fixtures.js'

function storeMock(): ScheduleEngineStore {
  return {
    listJobs: vi.fn(),
    claimNext: vi.fn(),
    getWorkerInput: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    recordNotification: vi.fn(),
  }
}

const claimed = { jobId: 'job-1', userId: 'user-1', emailNotification: true, attemptCount: 1, claimedAt: '2026-08-01T12:01:00Z' }
const result = {
  results: [{
    schedule: [{ ...workerInput.current_schedule[0], changed_from_enrollment_id: null }],
    collateral_change_count: 0,
    search_stage: 'direct_replacement' as const,
    explanations: ['Direct replacement.'],
  }],
  no_valid_schedule_reason: null,
}

describe('Schedule Engine worker', () => {
  let store: ScheduleEngineStore
  let predict: PredictionFunction
  let notify: PredictionReadyNotifier

  beforeEach(() => {
    store = storeMock()
    predict = vi.fn().mockResolvedValue(result)
    notify = vi.fn().mockResolvedValue({ status: 'not_configured' })
  })

  it('returns empty without calling the engine when the queue has no job', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(null)
    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('empty')
    expect(predict).not.toHaveBeenCalled()
  })

  it('builds input, saves results, and leaves unconfigured email pending', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(claimed)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('completed')

    expect(predict).toHaveBeenCalledWith(workerInput)
    expect(store.complete).toHaveBeenCalledWith('job-1', 'worker-1', result)
    expect(notify).toHaveBeenCalledWith(workerInput, result)
    expect(store.recordNotification).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('marks the claimed job failed when prediction throws', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(claimed)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    vi.mocked(predict).mockRejectedValue(new Error('Unexpected solver error.'))
    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('failed')

    expect(store.fail).toHaveBeenCalledWith('job-1', 'worker-1', 'Schedule Engine processing failed. The request can be tried again after the worker is checked.')
  })

  it('completes a well-explained no-solution request without fake predictions', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(claimed)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    const noSolution = { results: [], no_valid_schedule_reason: 'No legal existing section fits.' }
    vi.mocked(predict).mockResolvedValue(noSolution)

    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('completed')
    expect(store.complete).toHaveBeenCalledWith('job-1', 'worker-1', noSolution)
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('keeps a completed prediction completed when notification delivery fails', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(claimed)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    vi.mocked(notify).mockRejectedValue(new Error('Email provider unavailable'))

    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('completed')

    expect(store.complete).toHaveBeenCalledWith('job-1', 'worker-1', result)
    expect(store.recordNotification).toHaveBeenCalledWith('job-1', 'worker-1', {
      status: 'failed',
      errorMessage: 'Email notification failed after the prediction completed.',
    })
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('drains jobs until the first empty claim', async () => {
    vi.mocked(store.claimNext).mockResolvedValueOnce(claimed).mockResolvedValueOnce({ ...claimed, jobId: 'job-2' }).mockResolvedValueOnce(null)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    const summary = await processFullQueue({ store, workerId: 'worker-1', predict, notify })
    expect(summary).toEqual({ completed: 2, failed: 0 })
    expect(store.complete).toHaveBeenCalledTimes(2)
  })
})
