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
import { defaultUnknownSingleDayTerms } from './single-day-term.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim().replace(/\/$/, '') ?? ''
const SUPABASE_PUBLISHABLE_KEYS = readPublishableKeys()
const SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEYS[0] ?? ''
const SUPABASE_SECRET_KEY = readSecretKey()
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')?.trim() ?? ''
const CUSTOM_DOMAIN_ORIGIN = 'https://schedule.naclubs.net'
const LEGACY_PRODUCTION_ORIGIN = 'https://danielw412.github.io'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ProviderAttemptAudit {
  attempt: number
  http_status: number | null
  raw_output_excerpt: string | null
  parsed_output: unknown
  parse_error: string | null
  provider_error: unknown
}

interface ImportAuditContext {
  import_id: string | null
  user_id: string | null
  is_guest: boolean | null
  developer_mode: boolean
  image_metadata: Array<{ index: number; mime_type: string; byte_size: number }>
  configuration: {
    model_id: string
    thinking_level: string
    output_token_limit: number
    retry_incomplete_results: boolean
  } | null
  catalog_count: number | null
  course_ids_considered: string[]
  existing_class_count: number | null
  provider_attempts: ProviderAttemptAudit[]
}

// Hosted projects expose both the new publishable/secret keys and legacy
// anon/service-role fallbacks. Keep both so key rotation remains seamless.
function readNamedKeys(environmentName: string): string[] {
  const namedKeys = Deno.env.get(environmentName)
  if (!namedKeys) return []
  try {
    const parsed = JSON.parse(namedKeys) as Record<string, unknown>
    const defaultKey = typeof parsed.default === 'string' ? parsed.default.trim() : ''
    const otherKeys = Object.entries(parsed)
      .filter(([name, value]) => name !== 'default' && typeof value === 'string')
      .map(([, value]) => String(value).trim())
      .filter(Boolean)
    return [defaultKey, ...otherKeys].filter(Boolean)
  } catch {
    return []
  }
}

function readPublishableKeys(): string[] {
  const keys = [
    ...readNamedKeys('SUPABASE_PUBLISHABLE_KEYS'),
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim() ?? '',
    Deno.env.get('SUPABASE_ANON_KEY')?.trim() ?? '',
  ].filter(Boolean)
  return [...new Set(keys)]
}

function readSecretKey(): string {
  const namedKeys = readNamedKeys('SUPABASE_SECRET_KEYS')
  if (namedKeys.length > 0) return namedKeys[0]
  return Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    || ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createAuditContext(): ImportAuditContext {
  return {
    import_id: null,
    user_id: null,
    is_guest: null,
    developer_mode: false,
    image_metadata: [],
    configuration: null,
    catalog_count: null,
    course_ids_considered: [],
    existing_class_count: null,
    provider_attempts: [],
  }
}

async function captureUploadMetadata(request: Request, context: ImportAuditContext): Promise<void> {
  if (request.method !== 'POST') return
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) return
  try {
    const formData = await request.clone().formData()
    const importId = formData.get('import_id')
    context.import_id = typeof importId === 'string' && UUID_PATTERN.test(importId) ? importId : null
    context.developer_mode = formData.get('developer_mode') === 'true'
    context.image_metadata = formData.getAll('images')
      .filter((value): value is File => value instanceof File)
      .map((file, index) => ({
        index: index + 1,
        mime_type: file.type || 'unknown',
        byte_size: file.size,
      }))
  } catch {
    // The core handler returns the specific malformed-upload error. Audit capture
    // is best effort and must never replace the user-facing importer response.
  }
}

function geminiResponseText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length === 0) return null
  const candidate = value.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null
  const parts = candidate.content.parts
    .filter(isRecord)
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
  return parts.length > 0 ? parts.join('') : null
}

function truncateAuditText(value: string | null, limit = 12_000): string | null {
  if (!value) return null
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function parseAuditOutput(rawOutput: string | null): { parsed: unknown; error: string | null } {
  if (!rawOutput) return { parsed: null, error: null }
  try {
    return { parsed: JSON.parse(rawOutput), error: null }
  } catch (caught) {
    return {
      parsed: null,
      error: caught instanceof Error ? caught.message.slice(0, 500) : 'The provider output was not valid JSON.',
    }
  }
}

function providerErrorSummary(value: unknown): unknown {
  if (!isRecord(value)) return null
  const error = isRecord(value.error) ? value.error : value
  const summary: Record<string, unknown> = {}
  for (const key of ['code', 'status', 'message']) {
    const item = error[key]
    if (typeof item === 'string' || typeof item === 'number') summary[key] = item
  }
  return Object.keys(summary).length > 0 ? summary : null
}

function fetchGeminiWithTermDefaults(context: ImportAuditContext): typeof fetch {
  return async (input, init) => {
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (caught) {
      context.provider_attempts.push({
        attempt: context.provider_attempts.length + 1,
        http_status: null,
        raw_output_excerpt: null,
        parsed_output: null,
        parse_error: null,
        provider_error: {
          category: 'network',
          message: caught instanceof Error ? caught.message.slice(0, 1000) : String(caught).slice(0, 1000),
        },
      })
      throw caught
    }

    const payload = await response.clone().json().catch(() => null) as unknown
    if (!response.ok) {
      context.provider_attempts.push({
        attempt: context.provider_attempts.length + 1,
        http_status: response.status,
        raw_output_excerpt: null,
        parsed_output: null,
        parse_error: null,
        provider_error: providerErrorSummary(payload),
      })
      return response
    }

    let changed = false
    if (isRecord(payload) && Array.isArray(payload.candidates)) {
      for (const candidate of payload.candidates) {
        if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue
        for (const part of candidate.content.parts) {
          if (!isRecord(part) || typeof part.text !== 'string') continue
          const rewritten = defaultUnknownSingleDayTerms(part.text)
          if (rewritten === part.text) continue
          part.text = rewritten
          changed = true
        }
      }
    }

    const rawOutput = geminiResponseText(payload)
    const parsed = parseAuditOutput(rawOutput)
    context.provider_attempts.push({
      attempt: context.provider_attempts.length + 1,
      http_status: response.status,
      raw_output_excerpt: truncateAuditText(rawOutput),
      parsed_output: parsed.parsed,
      parse_error: parsed.error,
      provider_error: null,
    })

    if (!changed) return response
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
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

function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Supabase service environment is unavailable.')
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function guestKeyForRequest(request: Request): Promise<string> {
  const address = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${address}|${userAgent}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function resolveRequester(token: string, request: Request): Promise<{ userId: string | null; guestKey: string | null }> {
  const isPublishableKey = SUPABASE_PUBLISHABLE_KEYS.includes(token)
    || /^sb_publishable_[A-Za-z0-9_-]+$/.test(token)
  if (isPublishableKey) {
    return { userId: null, guestKey: await guestKeyForRequest(request) }
  }
  const { data, error } = await baseClient().auth.getUser(token)
  if (error || !data.user) throw error ?? new Error('Authenticated user missing.')
  return { userId: data.user.id, guestKey: null }
}

async function prepareImport(
  token: string,
  input: { developerMode: boolean; modelId: string | null; thinkingLevel: string | null },
  requester: { userId: string | null; guestKey: string | null },
): Promise<ImportConfiguration> {
  const client = requester.userId ? callerClient(token) : serviceClient()
  const preparation = requester.userId
    ? client.rpc('schedule_import_prepare', {
        p_developer_mode: input.developerMode,
        p_model_id: input.modelId,
        p_thinking_level: input.thinkingLevel,
      })
    : client.rpc('schedule_import_prepare_guest', { p_guest_key: requester.guestKey })
  const [prepared, profile, uiSettings] = await Promise.all([
    preparation,
    requester.userId
      ? client.from('profiles').select('grade').eq('id', requester.userId).single()
      : Promise.resolve({ data: null, error: null }),
    client.rpc('get_schedule_import_ui_settings'),
  ])
  const { data, error } = prepared
  if (error) throw error
  if (profile.error) throw profile.error
  if (uiSettings.error) throw uiSettings.error
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new Error('Schedule import configuration is missing.')
  const value = row as Record<string, unknown>
  const uiRow = Array.isArray(uiSettings.data) ? uiSettings.data[0] as Record<string, unknown> | undefined : undefined
  return {
    user_id: requester.userId,
    grade: requester.userId && profile.data && [9, 10, 11, 12].includes(Number(profile.data.grade))
      ? Number(profile.data.grade) as ImportConfiguration['grade']
      : null,
    is_guest: requester.userId === null,
    is_admin: Boolean(value.is_admin),
    bypassed_rate_limit: Boolean(value.bypassed_rate_limit),
    model_id: String(value.model_id ?? ''),
    thinking_level: String(value.thinking_level ?? '') as ImportConfiguration['thinking_level'],
    output_token_limit: Number(value.output_token_limit),
    retry_incomplete_results: uiRow?.retry_incomplete_results === undefined ? true : Boolean(uiRow.retry_incomplete_results),
  }
}

async function loadCatalog(token: string, config: ImportConfiguration): Promise<CourseRecord[]> {
  const client = config.is_guest ? serviceClient() : callerClient(token)
  const records: CourseRecord[] = []
  for (let offset = 0; offset < 20_000; offset += 1_000) {
    const { data, error } = await client
      .from('course_names')
      .select('id, name, term_policy')
      .eq('status', 'active')
      .order('name')
      .range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as CourseRecord[]
    records.push(...page)
    if (page.length < 1_000) return records
  }
  throw new Error('Course catalogue exceeds the safe import limit.')
}

async function loadClasses(token: string, config: ImportConfiguration, courseIds: string[]): Promise<ExistingClassRecord[]> {
  const selectedCourseIds = [...new Set(courseIds)]
  if (selectedCourseIds.length === 0) return []
  const client = config.is_guest ? serviceClient() : callerClient(token)
  const records: ExistingClassRecord[] = []
  for (let offset = 0; offset < 20_000; offset += 1_000) {
    const { data, error } = await client
      .from('classes')
      .select('id, course_name_id, teacher_last_name, default_academic_term, class_meeting_slots(day_type, period_number)')
      .eq('status', 'active')
      .in('course_name_id', selectedCourseIds)
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

async function countGuestMatches(classIds: string[]): Promise<number> {
  if (classIds.length === 0) return 0
  const { data, error } = await serviceClient().rpc('schedule_import_guest_match_count', {
    p_class_ids: [...new Set(classIds)],
  })
  if (error) throw error
  const count = Number(data ?? 0)
  if (!Number.isInteger(count) || count < 0) throw new Error('Guest match count was invalid.')
  return count
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

function dependencies(context: ImportAuditContext): ScheduleImportDependencies {
  return {
    geminiApiKey: GEMINI_API_KEY,
    resolveRequester: async (token, request) => {
      const requester = await resolveRequester(token, request)
      context.user_id = requester.userId
      context.is_guest = requester.userId === null
      return requester
    },
    prepareImport: async (token, input, requester) => {
      const config = await prepareImport(token, input, requester)
      context.configuration = {
        model_id: config.model_id,
        thinking_level: config.thinking_level,
        output_token_limit: config.output_token_limit,
        retry_incomplete_results: config.retry_incomplete_results,
      }
      return config
    },
    loadCatalog: async (token, config) => {
      const records = await loadCatalog(token, config)
      context.catalog_count = records.length
      return records
    },
    loadClasses: async (token, config, courseIds) => {
      context.course_ids_considered = [...new Set(courseIds)].slice(0, 100)
      const records = await loadClasses(token, config, courseIds)
      context.existing_class_count = records.length
      return records
    },
    countGuestMatches,
    recordDiagnostic,
    fetch: fetchGeminiWithTermDefaults(context),
  }
}

function failureStage(errorCode: string | null): string {
  if (!errorCode) return 'unknown'
  if ([
    'method_not_allowed', 'origin_not_allowed', 'authentication_required', 'session_expired',
    'multipart_required', 'invalid_form_data', 'invalid_image_count', 'invalid_import_id',
    'invalid_developer_mode', 'invalid_developer_option', 'unsupported_file_type', 'empty_file',
    'image_too_large', 'invalid_image_data',
  ].includes(errorCode)) return 'request_validation'
  if ([
    'authorization_mismatch', 'developer_mode_forbidden', 'developer_overrides_not_allowed',
    'schedule_import_not_configured', 'rate_limit_context_invalid', 'rate_limit_exceeded',
    'invalid_model_configuration',
  ].includes(errorCode)) return 'configuration'
  if (errorCode === 'catalog_unavailable') return 'catalog_loading'
  if (errorCode === 'classes_unavailable') return 'class_matching'
  if (['ai_invalid_response', 'schedule_not_detected', 'schedule_unreadable', 'schedule_periods_missing'].includes(errorCode)) {
    return 'ai_response_validation'
  }
  if (errorCode.startsWith('ai_')) return 'ai_provider_request'
  return 'unknown'
}

function summarizeReviewRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 30).flatMap((item) => {
    if (!isRecord(item)) return []
    const course = isRecord(item.course) ? item.course : null
    return [{
      source_course_name: typeof item.source_course_name === 'string' ? item.source_course_name : null,
      matched_course: course ? {
        id: typeof course.id === 'string' ? course.id : null,
        name: typeof course.name === 'string' ? course.name : null,
        confidence: typeof course.confidence === 'number' ? course.confidence : null,
      } : null,
      teacher_last_name: typeof item.teacher_last_name === 'string' ? item.teacher_last_name : null,
      term: typeof item.term === 'string' ? item.term : null,
      meeting_slots: Array.isArray(item.meeting_slots) ? item.meeting_slots : [],
      resolution: typeof item.resolution === 'string' ? item.resolution : null,
      existing_class_id: typeof item.existing_class_id === 'string' ? item.existing_class_id : null,
      flags: Array.isArray(item.flags) ? item.flags : [],
      warnings: Array.isArray(item.warnings) ? item.warnings : [],
    }]
  })
}

async function recordBackendImportAudit(context: ImportAuditContext, response: Response): Promise<void> {
  if (!context.import_id || !UUID_PATTERN.test(context.import_id) || !SUPABASE_SECRET_KEY) return
  const responseBody = await response.clone().json().catch(() => null) as unknown
  const body = isRecord(responseBody) ? responseBody : {}
  const succeeded = response.ok
  const errorCode = typeof body.error === 'string' ? body.error : null
  const developer = isRecord(body.developer) ? body.developer : null
  const lastAttempt = context.provider_attempts.at(-1) ?? null
  const metadata = {
    import_id: context.import_id,
    http_status: response.status,
    failure_stage: succeeded ? null : failureStage(errorCode),
    what_was_read: {
      ai_attempts: context.provider_attempts,
      selected_review_rows: summarizeReviewRows(body.rows),
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    },
    what_was_tried: {
      developer_mode: context.developer_mode,
      image_metadata: context.image_metadata,
      configuration: context.configuration,
      catalog_count: context.catalog_count,
      course_ids_considered: context.course_ids_considered,
      existing_class_count: context.existing_class_count,
      ai_attempt_count: context.provider_attempts.length,
      retry_attempted: context.provider_attempts.length > 1,
      retry_reasons: Array.isArray(body.retry_reasons) ? body.retry_reasons : [],
    },
    failure_cause: succeeded ? null : {
      code: errorCode ?? 'schedule_import_failure',
      message: typeof body.message === 'string' ? body.message : `Schedule importing returned HTTP ${response.status}.`,
      validation_errors: developer && Array.isArray(developer.validation_errors) ? developer.validation_errors : [],
      provider_error: lastAttempt?.provider_error ?? (developer ? developer.provider_error : null),
      provider_parse_error: lastAttempt?.parse_error ?? null,
    },
    result_summary: succeeded ? {
      row_count: Array.isArray(body.rows) ? body.rows.length : 0,
      image_count: typeof body.image_count === 'number' ? body.image_count : context.image_metadata.length,
      processing_duration_ms: typeof body.processing_duration_ms === 'number' ? body.processing_duration_ms : null,
      model: typeof body.model === 'string' ? body.model : context.configuration?.model_id ?? null,
      retry_count: typeof body.retry_count === 'number' ? body.retry_count : Math.max(0, context.provider_attempts.length - 1),
    } : null,
  }

  try {
    const { error } = await serviceClient().rpc('record_schedule_import_backend_event', {
      p_user_id: context.user_id,
      p_import_id: context.import_id,
      p_result: succeeded ? 'succeeded' : 'failed',
      p_metadata: metadata,
    })
    if (error) console.error('Schedule import audit logging failed.', { message: error.message })
  } catch (caught) {
    console.error('Schedule import audit logging failed.', {
      message: caught instanceof Error ? caught.message : String(caught),
    })
  }
}

function requestForGeminiHandler(request: Request): { request: Request; responseOrigin: string | null } {
  const origin = request.headers.get('Origin')?.trim()
  if (origin !== CUSTOM_DOMAIN_ORIGIN) return { request, responseOrigin: null }

  const headers = new Headers(request.headers)
  headers.set('Origin', LEGACY_PRODUCTION_ORIGIN)
  return {
    request: new Request(request, { headers }),
    responseOrigin: CUSTOM_DOMAIN_ORIGIN,
  }
}

function responseForBrowserOrigin(response: Response, origin: string | null): Response {
  if (!origin) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    const context = createAuditContext()
    await captureUploadMetadata(request, context)
    const bridged = requestForGeminiHandler(request)
    const response = await handleScheduleImportRequest(bridged.request, dependencies(context))
    await recordBackendImportAudit(context, response)
    return responseForBrowserOrigin(response, bridged.responseOrigin)
  },
}
