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
const result = [{ schedule: [{ ...workerInput.current_schedule[0], changed_from_enrollment_id: null }] }]

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
    expect(notify).toHaveBeenCalledWith(workerInput)
    expect(store.recordNotification).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('marks the claimed job failed when prediction is unavailable', async () => {
    vi.mocked(store.claimNext).mockResolvedValue(claimed)
    vi.mocked(store.getWorkerInput).mockResolvedValue(workerInput)
    vi.mocked(predict).mockRejectedValue(new Error('Schedule prediction is not implemented yet.'))
    await expect(processNextJob({ store, workerId: 'worker-1', predict, notify })).resolves.toBe('failed')

    expect(store.fail).toHaveBeenCalledWith('job-1', 'worker-1', 'Schedule prediction is not implemented yet.')
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
