import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ClaimedScheduleEngineJob, NotificationDelivery, PredictedScheduleResult, ScheduleEngineInput, ScheduleEngineStore, WorkerJobSummary } from './types.js'

interface RpcResponse {
  data: unknown
  error: { message: string } | null
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return recordFrom(value[0])
  return recordFrom(value)
}

function assertWorkerInput(value: unknown): ScheduleEngineInput {
  const row = recordFrom(value)
  if (!row || !recordFrom(row.job) || !recordFrom(row.user) || !Array.isArray(row.current_schedule) || !Array.isArray(row.replacements) || !Array.isArray(row.replacement_course_sections)) {
    throw new Error('Supabase returned an invalid Schedule Engine worker input.')
  }
  return row as unknown as ScheduleEngineInput
}

export class SupabaseScheduleEngineStore implements ScheduleEngineStore {
  constructor(private readonly client: SupabaseClient) {}

  async listJobs(limit = 100): Promise<WorkerJobSummary[]> {
    const data = await this.rpc('list_schedule_engine_jobs_for_worker', { p_limit: limit })
    if (!Array.isArray(data)) throw new Error('Supabase returned an invalid Schedule Engine job list.')
    return data as WorkerJobSummary[]
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const call = this.client.rpc.bind(this.client) as unknown as (functionName: string, parameters: Record<string, unknown>) => Promise<RpcResponse>
    const { data, error } = await call(name, args)
    if (error) throw new Error(error.message)
    return data
  }

  async claimNext(workerId: string): Promise<ClaimedScheduleEngineJob | null> {
    const row = firstRecord(await this.rpc('claim_next_schedule_engine_job', { p_worker_id: workerId }))
    if (!row) return null
    return {
      jobId: String(row.job_id),
      userId: String(row.user_id),
      emailNotification: Boolean(row.email_notification),
      attemptCount: Number(row.attempt_count),
      claimedAt: String(row.claimed_at),
    }
  }

  async getWorkerInput(jobId: string, workerId: string): Promise<ScheduleEngineInput> {
    return assertWorkerInput(await this.rpc('get_schedule_engine_worker_input', { p_job_id: jobId, p_worker_id: workerId }))
  }

  async complete(jobId: string, workerId: string, results: PredictedScheduleResult[]): Promise<void> {
    await this.rpc('complete_schedule_engine_job', { p_job_id: jobId, p_worker_id: workerId, p_results: results })
  }

  async fail(jobId: string, workerId: string, errorMessage: string): Promise<void> {
    await this.rpc('fail_schedule_engine_job', { p_job_id: jobId, p_worker_id: workerId, p_error_message: errorMessage })
  }

  async recordNotification(jobId: string, workerId: string, delivery: Exclude<NotificationDelivery, { status: 'not_configured' }>): Promise<void> {
    await this.rpc('record_schedule_engine_notification', {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_sent: delivery.status === 'sent',
      p_error_message: delivery.errorMessage,
    })
  }
}

export function createScheduleEngineStore(url: string, serviceRoleKey: string): SupabaseScheduleEngineStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseScheduleEngineStore(client)
}
