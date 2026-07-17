import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  handleScheduleImportRequest,
  type CourseRecord,
  type DiagnosticPayload,
  type ExistingClassRecord,
  type ImportConfiguration,
  type MeetingSlot,
  type ScheduleImportDependencies,
} from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim().replace(/\/$/, '') ?? ''
const SUPABASE_PUBLISHABLE_KEY = readPublishableKey()
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')?.trim() ?? ''

function readPublishableKey(): string {
  const namedKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (namedKeys) {
    try {
      const parsed = JSON.parse(namedKeys) as Record<string, unknown>
      if (typeof parsed.default === 'string') return parsed.default
    } catch {
      // Hosted projects also provide legacy/default fallbacks below.
    }
  }
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
    || Deno.env.get('SUPABASE_ANON_KEY')?.trim()
    || ''
}

function baseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase function environment is unavailable.')
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function callerClient(token: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase function environment is unavailable.')
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function verifyUser(token: string): Promise<{ id: string }> {
  const { data, error } = await baseClient().auth.getUser(token)
  if (error || !data.user) throw error ?? new Error('Authenticated user missing.')
  return { id: data.user.id }
}

async function prepareImport(
  token: string,
  input: { developerMode: boolean; modelId: string | null; thinkingLevel: string | null },
): Promise<ImportConfiguration> {
  const { data, error } = await callerClient(token).rpc('schedule_import_prepare', {
    p_developer_mode: input.developerMode,
    p_model_id: input.modelId,
    p_thinking_level: input.thinkingLevel,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new Error('Schedule import configuration is missing.')
  const value = row as Record<string, unknown>
  return {
    user_id: String(value.user_id ?? ''),
    is_admin: Boolean(value.is_admin),
    bypassed_rate_limit: Boolean(value.bypassed_rate_limit),
    model_id: String(value.model_id ?? ''),
    thinking_level: String(value.thinking_level ?? '') as ImportConfiguration['thinking_level'],
    output_token_limit: Number(value.output_token_limit),
  }
}

async function loadCatalog(token: string): Promise<CourseRecord[]> {
  const client = callerClient(token)
  const records: CourseRecord[] = []
  for (let offset = 0; offset < 20_000; offset += 1_000) {
    const { data, error } = await client
      .from('course_names')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as Array<{ id: string; name: string }>
    records.push(...page)
    if (page.length < 1_000) return records
  }
  throw new Error('Course catalogue exceeds the safe import limit.')
}

async function loadClasses(token: string): Promise<ExistingClassRecord[]> {
  const client = callerClient(token)
  const records: ExistingClassRecord[] = []
  for (let offset = 0; offset < 20_000; offset += 1_000) {
    const { data, error } = await client
      .from('classes')
      .select('id, course_name_id, teacher_last_name, default_academic_term, class_meeting_slots(day_type, period_number)')
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>
    records.push(...page.map((row) => ({
      id: String(row.id ?? ''),
      course_name_id: String(row.course_name_id ?? ''),
      teacher_last_name: String(row.teacher_last_name ?? ''),
      default_academic_term: String(row.default_academic_term ?? '') as ExistingClassRecord['default_academic_term'],
      meeting_slots: Array.isArray(row.class_meeting_slots)
        ? row.class_meeting_slots.map((slot) => {
            const value = slot as Record<string, unknown>
            return { day_type: value.day_type, period_number: Number(value.period_number) } as MeetingSlot
          })
        : [],
    })))
    if (page.length < 1_000) return records
  }
  throw new Error('Class list exceeds the safe import limit.')
}

async function recordDiagnostic(token: string, payload: DiagnosticPayload): Promise<string> {
  const { data, error } = await callerClient(token).rpc('record_schedule_import_diagnostic', {
    p_status: payload.status,
    p_model_id: payload.model_id,
    p_thinking_level: payload.thinking_level,
    p_output_token_limit: payload.output_token_limit,
    p_prompt: payload.prompt,
    p_raw_output: payload.raw_output,
    p_parsed_output: payload.parsed_output,
    p_validation_errors: payload.validation_errors,
    p_provider_error: payload.provider_error,
    p_timing_ms: payload.timing_ms,
    p_image_metadata: payload.image_metadata,
  })
  if (error) throw error
  return String(data ?? '')
}

function dependencies(): ScheduleImportDependencies {
  return {
    geminiApiKey: GEMINI_API_KEY,
    verifyUser,
    prepareImport,
    loadCatalog,
    loadClasses,
    recordDiagnostic,
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return handleScheduleImportRequest(request, dependencies())
  },
}
