import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlPanelHtml, startControlPanel } from '../src/gui.js'
import type { ScheduleEngineStore } from '../src/types.js'

const servers: Array<ReturnType<typeof startControlPanel>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('Schedule Engine control panel', () => {
  it('offers queue controls and debugging without embedding credentials', () => {
    const html = controlPanelHtml()
    expect(html).toContain('Process one job')
    expect(html).toContain('Process full queue')
    expect(html).toContain('Prediction engine ready')
    expect(html).toContain('displacement limit')
    expect(html).toContain('Raw debug data')
    expect(html).toContain('Automatically process new requests')
    expect(html).toContain('/api/auto-processing/')
    expect(html).toContain("if(markup===lastJobsMarkup)return")
    expect(html).toContain('data-debug-id')
    expect(html).not.toContain('Prediction engine not implemented')
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('enables automatic processing through the local API and reports the state', async () => {
    const store: ScheduleEngineStore = {
      listJobs: vi.fn().mockResolvedValue([]),
      claimNext: vi.fn().mockResolvedValue(null),
      getWorkerInput: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      recordNotification: vi.fn(),
    }
    const server = startControlPanel({
      store,
      workerId: 'test-worker',
      predict: vi.fn(),
      notify: vi.fn(),
      maxCollateralChanges: 2,
      emailConfigured: false,
      port: 0,
      autoProcessIntervalMs: 60_000,
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const port = (server.address() as AddressInfo).port

    const enabled = await fetch(`http://127.0.0.1:${port}/api/auto-processing/enable`, { method: 'POST' }).then((response) => response.json())
    expect(enabled).toEqual({ autoProcessing: true })
    const status = await fetch(`http://127.0.0.1:${port}/api/status`).then((response) => response.json())
    expect(status.autoProcessing).toBe(true)
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledWith('test-worker'))
  })
})
