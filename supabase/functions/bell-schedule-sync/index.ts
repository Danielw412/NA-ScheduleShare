import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'
import { handleBellScheduleSyncRequest, type BellSyncDependencies, type BellSyncFinishInput } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
const SUPABASE_PUBLISHABLE_KEY = readNamedKey('SUPABASE_PUBLISHABLE_KEYS')
  || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  || Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  || ''
const SUPABASE_SECRET_KEY = readNamedKey('SUPABASE_SECRET_KEYS')
  || Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
  || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  || ''
const GOOGLE_DOCS_API_KEY = Deno.env.get('GOOGLE_DOCS_API_KEY')?.trim() ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')?.trim() ?? ''
const BELL_SCHEDULE_SYNC_TOKEN = Deno.env.get('BELL_SCHEDULE_SYNC_TOKEN')?.trim() ?? ''

function readNamedKey(environmentName: string): string {
  const value = Deno.env.get(environmentName)
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed.default === 'string') return parsed.default.trim()
    return Object.values(parsed).find((candidate): candidate is string => typeof candidate === 'string')?.trim() ?? ''
  } catch { return '' }
}

function dependencies(): BellSyncDependencies {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
    throw new Error('Supabase function environment is unavailable.')
  }
  const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    googleDocsApiKey: GOOGLE_DOCS_API_KEY,
    geminiApiKey: GEMINI_API_KEY,
    schedulerToken: BELL_SCHEDULE_SYNC_TOKEN,
    verifyUser: async (token) => {
      const { data, error } = await authClient.auth.getUser(token)
      if (error || !data.user) throw error ?? new Error('Authenticated user missing.')
      return { id: data.user.id }
    },
    verifyAdmin: async (token) => {
      const callerClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data, error } = await callerClient.rpc('is_current_user_admin')
      if (error) throw error
      return Boolean(data)
    },
    claim: async (actorId, trigger, preview) => {
      const { data, error } = await serviceClient.rpc('service_claim_bell_schedule_sync', {
        p_actor_id: actorId,
        p_trigger: trigger,
        p_preview: preview,
      })
      if (error) throw error
      return data as unknown as Awaited<ReturnType<BellSyncDependencies['claim']>>
    },
    finish: async (input: BellSyncFinishInput) => {
      const { data, error } = await serviceClient.rpc('service_finish_bell_schedule_sync', {
        p_run_id: input.runId,
        p_status: input.status,
        p_source_hash: input.sourceHash,
        p_source_section: input.sourceSection,
        p_raw_json: input.rawJson,
        p_validated: input.validated,
        p_error: input.error,
        p_timing_ms: input.timingMs,
      })
      if (error) throw error
      return data as Record<string, unknown>
    },
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    try { return handleBellScheduleSyncRequest(request, dependencies()) }
    catch {
      return Promise.resolve(Response.json(
        { error: 'bell_schedule_sync_unavailable', message: 'Bell-schedule detection is not configured yet.' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
      ))
    }
  },
}
