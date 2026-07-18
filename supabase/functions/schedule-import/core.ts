export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES = 3

const PRODUCTION_ORIGIN = 'https://danielw412.github.io'
const LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ADMINISTRATIVE_COURSE_PATTERN = /^(?:(?:9th|10th|11th|12th)\s+grade|grade\s+(?:9|10|11|12)|counselor|case\s*manager|attendance)$/i
const SENSITIVE_KEY_PATTERN = /(?:authorization|token|secret|api.?key|image.?bytes|base64|inline.?data|data)/i

export type DayType = 'A' | 'B'
export type ImportTerm = 'full_year' | 'semester_1' | 'semester_2' | 'unknown'
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface MeetingSlot {
  day_type: DayType
  period_number: number
}

export interface CourseRecord {
  id: string
  name: string
}

export interface ExistingClassRecord {
  id: string
  course_name_id: string
  teacher_last_name: string
  default_academic_term: Exclude<ImportTerm, 'unknown'>
  meeting_slots: MeetingSlot[]
}

export interface ImportConfiguration {
  user_id: string
  is_admin: boolean
  bypassed_rate_limit: boolean
  model_id: string
  thinking_level: ThinkingLevel
  output_token_limit: number
}

export interface ImportClassOption {
  id: string
  course_id: string
  teacher_last_name: string
  term: Exclude<ImportTerm, 'unknown'>
  meeting_slots: MeetingSlot[]
}

export interface ImportReviewRow {
  id: string
  source_course_name: string
  course: { id: string; name: string; confidence: number } | null
  teacher_last_name: string
  term: ImportTerm
  meeting_slots: MeetingSlot[]
  confidence: number
  warnings: string[]
  flags: Array<'low_confidence' | 'unresolved_course' | 'ambiguous_course' | 'duplicate' | 'incomplete'>
  resolution: 'existing_class' | 'new_class' | 'unresolved_course'
  existing_class_id: string | null
  class_options: ImportClassOption[]
}

export interface ImageMetadata {
  index: number
  mime_type: string
  byte_size: number
}

export interface DeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: ThinkingLevel
  output_token_limit: number
  timing_ms: number
  image_metadata: ImageMetadata[]
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportResponse {
  rows: ImportReviewRow[]
  warnings: string[]
  image_count: number
  developer?: DeveloperDiagnostics
}

export interface DiagnosticPayload {
  status: 'success' | 'validation_error' | 'provider_error'
  model_id: string
  thinking_level: ThinkingLevel
  output_token_limit: number
  prompt: string
  raw_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  provider_error: unknown
  timing_ms: number
  image_metadata: ImageMetadata[]
}

export interface ScheduleImportDependencies {
  geminiApiKey: string
  verifyUser: (token: string) => Promise<{ id: string }>
  prepareImport: (
    token: string,
    input: { developerMode: boolean; modelId: string | null; thinkingLevel: string | null },
  ) => Promise<ImportConfiguration>
  loadCatalog: (token: string) => Promise<CourseRecord[]>
  loadClasses: (token: string) => Promise<ExistingClassRecord[]>
  recordDiagnostic: (token: string, payload: DiagnosticPayload) => Promise<string>
  fetch?: typeof fetch
  now?: () => number
  randomUUID?: () => string
  timeoutMs?: number
}

interface GeminiRow {
  course: string
  teacher: string
  term: string
  slots: string[]
}

export interface GeminiSchedule {
  schedule: boolean
  issue: string
  rows: GeminiRow[]
}

interface NormalizedGeminiRow {
  source_course_name: string
  teacher_raw: string
  term: ImportTerm
  meeting_slots: MeetingSlot[]
  duplicate: boolean
  term_defaulted: boolean
  term_inferred: boolean
}

interface EncodedImage {
  mimeType: string
  base64: string
  metadata: ImageMetadata
}

interface CourseMatch {
  kind: 'matched' | 'ambiguous' | 'unresolved'
  course: CourseRecord | null
  score: number
  alternatives: CourseRecord[]
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly validationErrors: string[] = [],
    readonly providerDetails: unknown = null,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

export function buildPrompt(): string {
  return `Transcribe the student class schedule visible in the one to three supplied screenshots.

Return only the required structured JSON data. Do not use Markdown, confidence scores, catalogue IDs, or extra fields.

Required shape:
{"schedule":true,"issue":"","rows":[{"course":"AP Biology (CHS)","teacher":"Spak, Jill","term":"FY","slots":["A1","B1","A2"]}]}

Extraction rules:
- Read every visible class from all supplied screenshots.
- Do not depend on fixed column names such as Exp or Period.
- Meeting information may appear in rows, cards, A/B columns, grids, or beside the course.
- Keep course, teacher, term, and meeting information associated with the same visible row or position.
- Never infer periods from row order or visual ordering alone.
- Support visible formats such as P01(A-B), P02(A), P06(B), A Day Period 3, B4, and equivalent formats.
- Convert full-year terms such as 25-26 to FY, semester 1 to S1, and semester 2 to S2.
- Include Lunch and Study Hall.
- "Health & PE" and variations should be canonicalized to "Gym"
- Ignore grade-level, counselor, case-manager, attendance, and other administrative rows.
- Preserve visible course and teacher names exactly. Do not invent, correct, expand, rename, or canonicalize them.
- Return unknown when the term is not visible. The application will default an unknown term to Full Year during review.
- Resolve semester terms as a schedule constraint, not from row order: two distinct courses cannot occupy the same A/B day and period during the same semester.
- When exactly two distinct rows have the same complete set of meeting slots, one row explicitly says semester 1 or semester 2, and the other row has no visible term, assign the other row to the complementary semester. Lunch follows the same rule as every other course; do not special-case a course name.
- Apply that complementary-semester inference only when it is uniquely determined. If several rows conflict, both terms are unknown, a row explicitly says full year, or the meeting slots are not identical, leave the uncertain term as unknown.
- Never infer a semester from vertical proximity, row order, or the mere fact that two rows are near one another.
- Use slot strings in A1 through A9 or B1 through B9 form. Include every explicitly visible A/B meeting slot and remove duplicate slots.
- If the images are not a readable student schedule, return {"schedule":false,"issue":"a short, specific explanation of what is wrong and what the user should recapture","rows":[]}.
- For a readable schedule, issue must be an empty string. For an unreadable, cropped, obstructed, unrelated, or blurry image, issue must explain the visible problem in plain language rather than using a generic failure message.
- Return only the required structured data.

The following courses are normally double-period courses and should have two meeting periods on each applicable day:
  - AP Calculus BC (CHS)
  - Academic Biology
  - Honors Biology
  - Honors Chemistry
  - Academic Chemistry
  - AP Chemistry (CHS)
  - Honors Physics
  - AP Physics 1 & 2 (CHS)
  - AP Physics C
  - AP Biology (CHS)
`
}

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schedule: { type: 'boolean' },
    issue: { type: 'string', maxLength: 280, description: 'Empty for a readable schedule; otherwise a concise, actionable description of the screenshot problem.' },
    rows: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          course: { type: 'string', description: 'The visible course name exactly as written.' },
          teacher: { type: 'string', description: 'The visible teacher name exactly as written.' },
          term: { type: 'string', description: 'FY, S1, S2, or unknown.' },
          slots: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', description: 'An explicit A1-A9 or B1-B9 meeting slot.' },
          },
        },
        required: ['course', 'teacher', 'term', 'slots'],
      },
    },
  },
  required: ['schedule', 'issue', 'rows'],
} as const

export function buildGeminiRequest(
  prompt: string,
  images: EncodedImage[],
  config: Pick<ImportConfiguration, 'thinking_level' | 'output_token_limit'>,
): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: config.output_token_limit,
      responseMimeType: 'application/json',
      responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
      thinkingConfig: {
        thinkingLevel: config.thinking_level.toUpperCase(),
        includeThoughts: false,
      },
    },
  }
}

export async function handleScheduleImportRequest(
  request: Request,
  dependencies: ScheduleImportDependencies,
): Promise<Response> {
  const requestStartedAt = (dependencies.now ?? Date.now)()
  let responseOrigin = PRODUCTION_ORIGIN
  let token: string | null = null
  let config: ImportConfiguration | null = null
  let developerRequested = false
  let rawOutput: string | null = null
  let parsedOutput: unknown = null
  let imageMetadata: ImageMetadata[] = []

  try {
    responseOrigin = allowedOrigin(request)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) })
    }
    if (request.method !== 'POST') {
      throw new HttpError(405, 'method_not_allowed', 'Use POST for schedule importing.')
    }

    token = getBearerToken(request)
    const user = await verifyAuthenticatedUser(token, dependencies)
    const upload = await readUpload(request)
    developerRequested = upload.developerMode
    const images = await Promise.all(upload.files.map((file, index) => validateAndEncodeImage(file, index + 1)))
    imageMetadata = images.map((image) => image.metadata)

    config = await dependencies.prepareImport(token, {
      developerMode: upload.developerMode,
      modelId: upload.modelId,
      thinkingLevel: upload.thinkingLevel,
    })
    validateImportConfiguration(config, user.id, upload.developerMode)

    const [catalog, classes] = await Promise.all([
      dependencies.loadCatalog(token),
      dependencies.loadClasses(token),
    ])
    validateBackendData(catalog, classes)

    const prompt = buildPrompt()
    rawOutput = await invokeGemini(images, config, dependencies)
    const parsed = parseGeminiSchedule(rawOutput)
    parsedOutput = parsed
    const normalizedRows = normalizeGeminiRows(parsed)
    const rows = buildReviewRows(normalizedRows, catalog, classes, dependencies.randomUUID)
    const elapsedMs = Math.max(0, (dependencies.now ?? Date.now)() - requestStartedAt)
    let developer: DeveloperDiagnostics | undefined

    if (upload.developerMode) {
      const diagnostic = await persistDiagnosticSafely(token, dependencies, {
        status: 'success',
        model_id: config.model_id,
        thinking_level: config.thinking_level,
        output_token_limit: config.output_token_limit,
        prompt,
        raw_output: rawOutput,
        parsed_output: parsedOutput,
        validation_errors: [],
        provider_error: null,
        timing_ms: elapsedMs,
        image_metadata: imageMetadata,
      })
      developer = {
        prompt,
        raw_gemini_output: rawOutput,
        parsed_output: parsedOutput,
        validation_errors: [],
        model: config.model_id,
        thinking_level: config.thinking_level,
        output_token_limit: config.output_token_limit,
        timing_ms: elapsedMs,
        image_metadata: imageMetadata,
        provider_error: null,
        diagnostic_log_id: diagnostic.id,
        ...(diagnostic.error ? { diagnostic_log_error: diagnostic.error } : {}),
      }
    }

    return jsonResponse(responseOrigin, 200, {
      rows,
      warnings: [],
      image_count: images.length,
      ...(developer ? { developer } : {}),
    } satisfies ScheduleImportResponse)
  } catch (caught) {
    const error = toHttpError(caught)
    const validationErrors = error.validationErrors
    const providerError = error.providerDetails
    const elapsedMs = Math.max(0, (dependencies.now ?? Date.now)() - requestStartedAt)
    let developer: DeveloperDiagnostics | undefined

    if (developerRequested && token && config?.is_admin && config.bypassed_rate_limit) {
      const prompt = buildPrompt()
      const status: DiagnosticPayload['status'] = providerError ? 'provider_error' : 'validation_error'
      const diagnostic = await persistDiagnosticSafely(token, dependencies, {
        status,
        model_id: config.model_id,
        thinking_level: config.thinking_level,
        output_token_limit: config.output_token_limit,
        prompt,
        raw_output: rawOutput,
        parsed_output: parsedOutput,
        validation_errors: validationErrors,
        provider_error: providerError,
        timing_ms: elapsedMs,
        image_metadata: imageMetadata,
      })
      developer = {
        prompt,
        raw_gemini_output: rawOutput,
        parsed_output: parsedOutput,
        validation_errors: validationErrors,
        model: config.model_id,
        thinking_level: config.thinking_level,
        output_token_limit: config.output_token_limit,
        timing_ms: elapsedMs,
        image_metadata: imageMetadata,
        provider_error: providerError,
        diagnostic_log_id: diagnostic.id,
        ...(diagnostic.error ? { diagnostic_log_error: diagnostic.error } : {}),
      }
    }

    return jsonResponse(
      responseOrigin,
      error.status,
      {
        error: error.code,
        message: error.message,
        ...(developer ? { developer } : {}),
      },
      error.retryAfter,
    )
  }
}

async function verifyAuthenticatedUser(
  token: string,
  dependencies: ScheduleImportDependencies,
): Promise<{ id: string }> {
  try {
    const user = await dependencies.verifyUser(token)
    if (!user || !UUID_PATTERN.test(user.id)) throw new Error('invalid user result')
    return user
  } catch {
    throw new HttpError(401, 'session_expired', 'Your session has expired. Refresh the page and sign in again.')
  }
}

function validateImportConfiguration(config: ImportConfiguration, userId: string, developerMode: boolean): void {
  if (!config || config.user_id !== userId || !UUID_PATTERN.test(config.user_id)) {
    throw new HttpError(403, 'authorization_mismatch', 'The import authorization context could not be verified.')
  }
  if (!/^gemini-[a-z0-9.-]+$/.test(config.model_id)
    || !isThinkingLevel(config.thinking_level)
    || !Number.isInteger(config.output_token_limit)
    || config.output_token_limit < 256
    || config.output_token_limit > 8192) {
    throw new HttpError(503, 'schedule_import_not_configured', 'Schedule importing is not configured correctly.')
  }
  if (developerMode && (!config.is_admin || !config.bypassed_rate_limit)) {
    throw new HttpError(403, 'developer_mode_forbidden', 'Administrator access is required for AI developer mode.')
  }
  if (!developerMode && config.bypassed_rate_limit) {
    throw new HttpError(503, 'rate_limit_context_invalid', 'The schedule import rate-limit context was invalid.')
  }
}

function validateBackendData(catalog: CourseRecord[], classes: ExistingClassRecord[]): void {
  if (!Array.isArray(catalog) || catalog.length === 0 || catalog.some((course) => (
    !UUID_PATTERN.test(course.id) || typeof course.name !== 'string' || course.name.trim().length < 2
  ))) {
    throw new HttpError(503, 'catalog_unavailable', 'The course catalogue is temporarily unavailable.')
  }
  if (!Array.isArray(classes) || classes.some((classRecord) => (
    !UUID_PATTERN.test(classRecord.id)
    || !UUID_PATTERN.test(classRecord.course_name_id)
    || typeof classRecord.teacher_last_name !== 'string'
    || !isAcademicTerm(classRecord.default_academic_term)
    || !validNormalizedSlots(classRecord.meeting_slots)
  ))) {
    throw new HttpError(503, 'classes_unavailable', 'Existing classes are temporarily unavailable.')
  }
}

async function readUpload(request: Request): Promise<{
  files: File[]
  developerMode: boolean
  modelId: string | null
  thinkingLevel: string | null
}> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'multipart_required', 'Upload screenshots as multipart form data.')
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_form_data', 'The screenshot upload could not be read.')
  }

  const files = formData.getAll('images').filter((value): value is File => value instanceof File)
  if (files.length < 1 || files.length > MAX_IMAGES) {
    throw new HttpError(400, 'invalid_image_count', 'Upload between one and three schedule screenshots.')
  }

  const developerValue = formData.get('developer_mode')
  if (developerValue !== null && developerValue !== 'true' && developerValue !== 'false') {
    throw new HttpError(400, 'invalid_developer_mode', 'The developer-mode setting was invalid.')
  }
  const developerMode = developerValue === 'true'
  const modelId = optionalFormString(formData.get('model'))
  const thinkingLevel = optionalFormString(formData.get('thinking_level'))
  if (!developerMode && (modelId || thinkingLevel)) {
    throw new HttpError(403, 'developer_overrides_not_allowed', 'Model overrides require administrator developer mode.')
  }

  return { files, developerMode, modelId, thinkingLevel }
}

async function validateAndEncodeImage(file: File, index: number): Promise<EncodedImage> {
  const mimeType = file.type.toLowerCase()
  if (!IMAGE_TYPES.has(mimeType)) {
    throw new HttpError(415, 'unsupported_file_type', 'Use a PNG, JPEG, or WebP image.')
  }
  if (file.size <= 0) throw new HttpError(400, 'empty_file', 'One of the screenshots is empty.')
  if (file.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'image_too_large', 'Each screenshot must be 5 MB or smaller.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!matchesImageSignature(bytes, mimeType)) {
    throw new HttpError(415, 'invalid_image_data', 'One screenshot does not contain valid PNG, JPEG, or WebP data.')
  }
  return {
    mimeType,
    base64: bytesToBase64(bytes),
    metadata: { index, mime_type: mimeType, byte_size: bytes.byteLength },
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function invokeGemini(
  images: EncodedImage[],
  config: ImportConfiguration,
  dependencies: Pick<ScheduleImportDependencies, 'geminiApiKey' | 'fetch' | 'timeoutMs'>,
): Promise<string> {
  const apiKey = dependencies.geminiApiKey?.trim()
  if (!apiKey) {
    throw new HttpError(503, 'schedule_import_not_configured', 'Schedule importing is not configured yet.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS)
  let response: Response
  try {
    response = await (dependencies.fetch ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model_id)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(buildGeminiRequest(buildPrompt(), images, config)),
        signal: controller.signal,
      },
    )
  } catch (caught) {
    clearTimeout(timeout)
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw new HttpError(504, 'ai_timeout', 'Schedule recognition timed out. Try again.', [], {
        category: 'timeout',
        message: 'The Gemini request exceeded the configured timeout.',
      })
    }
    throw new HttpError(503, 'ai_unavailable', 'Schedule recognition is temporarily unavailable.', [], {
      category: 'network',
      message: safeErrorMessage(caught),
    })
  } finally {
    clearTimeout(timeout)
  }

  const responseBody = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const safeProviderError = redactSensitiveValue({ status: response.status, body: responseBody }, [apiKey])
    if (response.status === 429) {
      throw new HttpError(503, 'ai_quota_exceeded', 'Schedule recognition is temporarily at capacity. Try again later.', [], safeProviderError)
    }
    throw new HttpError(502, 'ai_provider_error', 'Gemini could not process the schedule screenshots.', [], safeProviderError)
  }

  const text = geminiResponseText(responseBody)
  if (text === null) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned an incomplete response.', [
      'Gemini did not return a text candidate.',
    ])
  }
  return text
}

function geminiResponseText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length === 0) return null
  const candidate = value.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null
  const parts = candidate.content.parts
    .filter(isRecord)
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
  return parts.length ? parts.join('') : null
}

export function parseGeminiSchedule(rawOutput: string): GeminiSchedule {
  let value: unknown
  try {
    value = JSON.parse(rawOutput.trim())
  } catch {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned malformed data.', [
      'The Gemini text candidate was not valid JSON.',
    ])
  }

  const errors: string[] = []
  if (!isRecord(value)) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned malformed data.', [
      'The top-level Gemini output must be an object.',
    ])
  }
  exactKeys(value, ['schedule', 'issue', 'rows'], '$', errors)
  if (typeof value.schedule !== 'boolean') errors.push('$.schedule must be a boolean.')
  if (typeof value.issue !== 'string' || value.issue.length > 280) errors.push('$.issue must be a string no longer than 280 characters.')
  if (value.schedule === false && (typeof value.issue !== 'string' || collapseWhitespace(value.issue).length < 3)) {
    errors.push('$.issue must explain why the screenshot cannot be used when $.schedule is false.')
  }
  if (!Array.isArray(value.rows)) errors.push('$.rows must be an array.')
  if (Array.isArray(value.rows) && value.rows.length > 30) errors.push('$.rows may contain at most 30 rows.')

  const rows: GeminiRow[] = []
  if (Array.isArray(value.rows)) {
    value.rows.forEach((candidate, index) => {
      const path = `$.rows[${index}]`
      if (!isRecord(candidate)) {
        errors.push(`${path} must be an object.`)
        return
      }
      exactKeys(candidate, ['course', 'teacher', 'term', 'slots'], path, errors)
      if (typeof candidate.course !== 'string' || candidate.course.trim().length < 2 || candidate.course.length > 160) {
        errors.push(`${path}.course must be a string from 2 through 160 characters.`)
      }
      if (typeof candidate.teacher !== 'string' || candidate.teacher.length > 200) {
        errors.push(`${path}.teacher must be a string no longer than 200 characters.`)
      }
      if (typeof candidate.term !== 'string' || !normalizeTerm(candidate.term)) {
        errors.push(`${path}.term must be FY, S1, S2, unknown, or an equivalent visible term.`)
      }
      if (!Array.isArray(candidate.slots) || candidate.slots.length === 0 || candidate.slots.length > 4
        || !candidate.slots.every((slot) => typeof slot === 'string')) {
        errors.push(`${path}.slots must contain one through four string slots.`)
      } else {
        try {
          normalizeSlots(candidate.slots)
        } catch (caught) {
          errors.push(...(caught instanceof HttpError ? caught.validationErrors.map((message) => `${path}.slots: ${message}`) : [`${path}.slots are invalid.`]))
        }
      }
      if (errors.some((message) => message.startsWith(path))) return
      rows.push({
        course: collapseWhitespace(candidate.course as string),
        teacher: collapseWhitespace(candidate.teacher as string),
        term: candidate.term as string,
        slots: candidate.slots as string[],
      })
    })
  }

  if (errors.length) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned invalid structured data.', errors)
  }
  return { schedule: value.schedule as boolean, issue: collapseWhitespace(value.issue as string), rows }
}

export function normalizeTerm(value: string): ImportTerm | null {
  const normalized = collapseWhitespace(value).toLowerCase().replace(/[._]/g, ' ')
  if (normalized === '' || normalized === 'unknown' || normalized === 'not visible' || normalized === 'n/a') return 'unknown'
  if (/^(?:fy|full\s*year|\d{2}\s*[-/]\s*\d{2}|fy\s*\/\s*pt)$/.test(normalized)) return 'full_year'
  if (/^(?:s1|sem(?:ester)?\s*1|first\s+semester|1st\s+semester)$/.test(normalized)) return 'semester_1'
  if (/^(?:s2|sem(?:ester)?\s*2|second\s+semester|2nd\s+semester)$/.test(normalized)) return 'semester_2'
  return null
}

function termFromCourseName(value: string): Exclude<ImportTerm, 'unknown'> | null {
  const normalized = collapseWhitespace(value).toLowerCase()
  if (/\(\s*(?:s1|sem(?:ester)?\s*1)\s*\)/.test(normalized)) return 'semester_1'
  if (/\(\s*(?:s2|sem(?:ester)?\s*2)\s*\)/.test(normalized)) return 'semester_2'
  if (/\(\s*(?:fy|full\s*year|fy\s*\/\s*pt)\s*\)/.test(normalized)) return 'full_year'
  return null
}

export function normalizeSlots(values: string[]): MeetingSlot[] {
  const slots: MeetingSlot[] = []
  const errors: string[] = []
  values.forEach((value, index) => {
    const parsed = parseVisibleSlot(value)
    if (parsed.length === 0) errors.push(`slot ${index + 1} (${JSON.stringify(value)}) is not a supported A/B period.`)
    slots.push(...parsed)
  })
  const unique = uniqueSlots(slots)
  if (unique.length === 0) errors.push('At least one explicit meeting slot is required.')
  if (unique.length > 4) errors.push('A class may contain at most four unique meeting slots.')
  if (!validNormalizedSlots(unique)) errors.push('Every slot must use A or B day and a period from 1 through 9.')
  for (const dayType of ['A', 'B'] as const) {
    const periods = unique.filter((slot) => slot.day_type === dayType).map((slot) => slot.period_number).sort((left, right) => left - right)
    if (periods.length > 2) errors.push(`${dayType} day may contain at most two periods.`)
    if (periods.length === 2 && periods[1] !== periods[0] + 1) errors.push(`${dayType} day multiple periods must be consecutive.`)
  }
  if (errors.length) throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned invalid meeting slots.', errors)
  return sortSlots(unique)
}

function parseVisibleSlot(value: string): MeetingSlot[] {
  const normalized = collapseWhitespace(value).toUpperCase()
  const powerSchool = normalized.match(/^P?0?([1-9])\s*\(\s*(A\s*[-/]\s*B|A|B)\s*\)$/)
  if (powerSchool) {
    const period = Number(powerSchool[1])
    const days = powerSchool[2].replace(/\s/g, '').length > 1 ? ['A', 'B'] as const : [powerSchool[2].trim() as DayType]
    return days.map((dayType) => ({ day_type: dayType, period_number: period }))
  }
  const dayFirst = normalized.match(/^([AB])(?:\s+DAY)?(?:\s+P(?:ERIOD)?)?\s*0?([1-9])$/)
  if (dayFirst) return [{ day_type: dayFirst[1] as DayType, period_number: Number(dayFirst[2]) }]
  const periodFirst = normalized.match(/^(?:P(?:ERIOD)?\s*)?0?([1-9])\s*\(?\s*([AB])\s*\)?$/)
  if (periodFirst) return [{ day_type: periodFirst[2] as DayType, period_number: Number(periodFirst[1]) }]
  return []
}

function normalizeGeminiRows(schedule: GeminiSchedule): NormalizedGeminiRow[] {
  if (!schedule.schedule) {
    throw new HttpError(422, 'schedule_not_detected', `The screenshot could not be used: ${schedule.issue}`)
  }
  const visibleRows = schedule.rows.filter((row) => !ADMINISTRATIVE_COURSE_PATTERN.test(row.course.trim()))
  if (visibleRows.length === 0) {
    throw new HttpError(422, 'schedule_unreadable', 'No visible schedule classes with explicit periods could be read.')
  }

  const preparedRows = visibleRows.map((row) => {
    const parsedTerm = normalizeTerm(row.term)
    if (!parsedTerm) throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned an invalid term.')
    return {
      source_course_name: collapseWhitespace(row.course),
      teacher_raw: collapseWhitespace(row.teacher),
      term: termFromCourseName(row.course) ?? parsedTerm,
      meeting_slots: normalizeSlots(row.slots),
      term_inferred: false,
    }
  })

  const rowsBySlots = new Map<string, typeof preparedRows>()
  for (const row of preparedRows) {
    const key = slotsKey(row.meeting_slots)
    rowsBySlots.set(key, [...(rowsBySlots.get(key) ?? []), row])
  }
  for (const sameSlotRows of rowsBySlots.values()) {
    if (sameSlotRows.length !== 2) continue
    const unknownRows = sameSlotRows.filter((row) => row.term === 'unknown')
    const semesterRows = sameSlotRows.filter((row) => row.term === 'semester_1' || row.term === 'semester_2')
    if (unknownRows.length !== 1 || semesterRows.length !== 1) continue
    if (normalizeCourseName(unknownRows[0].source_course_name) === normalizeCourseName(semesterRows[0].source_course_name)) continue
    unknownRows[0].term = semesterRows[0].term === 'semester_1' ? 'semester_2' : 'semester_1'
    unknownRows[0].term_inferred = true
  }

  const merged = new Map<string, NormalizedGeminiRow>()
  for (const row of preparedRows) {
    const visibleTerm = row.term
    const termDefaulted = visibleTerm === 'unknown'
    const term: ImportTerm = termDefaulted ? 'full_year' : visibleTerm
    const key = `${normalizeCourseName(row.source_course_name)}|${row.teacher_raw.toLowerCase()}|${term}|${slotsKey(row.meeting_slots)}`
    const current = merged.get(key)
    if (!current) {
      merged.set(key, {
        source_course_name: row.source_course_name,
        teacher_raw: row.teacher_raw,
        term,
        meeting_slots: row.meeting_slots,
        duplicate: false,
        term_defaulted: termDefaulted,
        term_inferred: row.term_inferred,
      })
      continue
    }
    merged.set(key, {
      ...current,
      duplicate: true,
      term_defaulted: current.term_defaulted && termDefaulted,
      term_inferred: current.term_inferred || row.term_inferred,
    })
  }
  return [...merged.values()]
}

export function findCourseMatch(sourceName: string, catalog: CourseRecord[]): CourseMatch {
  const ranked = catalog
    .map((course) => ({ course, score: courseSimilarity(sourceName, course.name) }))
    .sort((left, right) => right.score - left.score || left.course.name.localeCompare(right.course.name))
  const best = ranked[0]
  const second = ranked[1]
  if (!best) return { kind: 'unresolved', course: null, score: 0, alternatives: [] }
  const margin = best.score - (second?.score ?? 0)
  if (best.score >= 0.995 || (best.score >= 0.93 && margin >= 0.03) || (best.score >= 0.86 && margin >= 0.08)) {
    return { kind: 'matched', course: best.course, score: best.score, alternatives: [] }
  }
  if (best.score >= 0.72 && second && second.score >= 0.68 && margin < 0.08) {
    return {
      kind: 'ambiguous',
      course: null,
      score: best.score,
      alternatives: ranked.slice(0, 3).map((candidate) => candidate.course),
    }
  }
  return { kind: 'unresolved', course: null, score: best.score, alternatives: ranked.slice(0, 3).map((candidate) => candidate.course) }
}

function buildReviewRows(
  entries: NormalizedGeminiRow[],
  catalog: CourseRecord[],
  classes: ExistingClassRecord[],
  randomUUID: (() => string) | undefined,
): ImportReviewRow[] {
  return entries.map((entry, index) => {
    const match = findCourseMatch(entry.source_course_name, catalog)
    const options = match.course ? classOptionsFor(match.course.id, classes) : []
    const teacherLastName = parseTeacherLastName(entry.teacher_raw, match.course?.name ?? entry.source_course_name)
    const existing = match.course ? exactClassMatch(entry, teacherLastName, options) : null
    const flags: ImportReviewRow['flags'] = []
    const warnings: string[] = []
    if (match.kind === 'unresolved') flags.push('unresolved_course')
    if (match.kind === 'ambiguous') {
      flags.push('unresolved_course', 'ambiguous_course')
      warnings.push(`Catalogue match is ambiguous among: ${match.alternatives.map((course) => course.name).join(', ')}.`)
    }
    if (match.kind !== 'matched' || match.score < 0.9) flags.push('low_confidence')
    if (entry.duplicate) {
      flags.push('duplicate')
      warnings.push('An exact duplicate screenshot row was merged.')
    }
    if (entry.term_defaulted) {
      warnings.push('Academic term was not visible, so Full Year was selected by default.')
    }
    if (entry.term_inferred) {
      warnings.push('Academic term was inferred from the complementary semester course in the same meeting slot.')
    }
    return {
      id: `import-${index + 1}-${randomUUID ? randomUUID() : crypto.randomUUID()}`,
      source_course_name: entry.source_course_name,
      course: match.course ? { id: match.course.id, name: match.course.name, confidence: match.score } : null,
      teacher_last_name: teacherLastName,
      term: entry.term,
      meeting_slots: entry.meeting_slots,
      confidence: match.kind === 'matched' ? match.score : Math.min(0.74, Math.max(0.25, match.score)),
      warnings,
      flags,
      resolution: !match.course ? 'unresolved_course' : existing ? 'existing_class' : 'new_class',
      existing_class_id: existing?.id ?? null,
      class_options: options,
    }
  })
}

export function parseTeacherLastName(raw: string, courseName = ''): string {
  const normalizedCourse = normalizeCourseName(courseName)
  if (normalizedCourse === 'lunch' || normalizedCourse === 'study hall') return 'N/A'
  let teacher = collapseWhitespace(raw)
    .replace(/^email\s+/i, '')
    .replace(/\s*-\s*rm\s*:\s*.*$/i, '')
    .replace(/\s+room\s*:?.*$/i, '')
    .trim()
  if (/^staff\s*,?\s*unassigned$/i.test(teacher) || !teacher) return 'N/A'
  teacher = teacher.split(',')[0]?.trim() ?? ''
  return teacher || 'N/A'
}

function classOptionsFor(courseId: string, classes: ExistingClassRecord[]): ImportClassOption[] {
  return classes
    .filter((classRecord) => classRecord.course_name_id === courseId)
    .map((classRecord) => ({
      id: classRecord.id,
      course_id: classRecord.course_name_id,
      teacher_last_name: classRecord.teacher_last_name,
      term: classRecord.default_academic_term,
      meeting_slots: sortSlots(classRecord.meeting_slots),
    }))
}

function exactClassMatch(
  entry: NormalizedGeminiRow,
  teacherLastName: string,
  options: ImportClassOption[],
): ImportClassOption | null {
  if (entry.term === 'unknown') return null
  const key = slotsKey(entry.meeting_slots)
  return options.find((option) => (
    option.term === entry.term
    && collapseWhitespace(option.teacher_last_name).toLowerCase() === teacherLastName.toLowerCase()
    && slotsKey(option.meeting_slots) === key
  )) ?? null
}

function normalizeCourseName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\(\s*chs\s*\)/g, ' ')
    .replace(/\(\s*(?:sem(?:ester)?\s*[12]|s[12]|fy|full\s*year|fy\s*\/\s*pt)\s*\)\s*\d*/g, ' ')
    .replace(/\bhon\b/g, 'honors')
    .replace(/\bmod\b/g, 'modern')
    .replace(/\bamer\b/g, 'american')
    .replace(/\bpre[\s-]?calc\b/g, 'precalculus')
    .replace(/\bcalc\b/g, 'calculus')
    .replace(/\bcomp\s+sci\b/g, 'computer science')
    .replace(/\bbio\b/g, 'biology')
    .replace(/\bchem\b/g, 'chemistry')
    .replace(/\blang\b/g, 'language')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  if (/^health (?:and )?(?:p e|pe|physical education|phys ed)(?: \d{1,2})?$/.test(normalized)) return 'gym'
  return normalized
}

function courseSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeCourseName(left)
  const normalizedRight = normalizeCourseName(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft === normalizedRight) return 1
  const leftTokens = new Set(normalizedLeft.split(' '))
  const rightTokens = new Set(normalizedRight.split(' '))
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1
  const dice = (2 * shared) / (leftTokens.size + rightTokens.size)
  const edit = 1 - levenshtein(normalizedLeft, normalizedRight) / Math.max(normalizedLeft.length, normalizedRight.length)
  const containment = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 0.88 : 0
  return Math.max(containment, dice * 0.68 + edit * 0.32)
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

export function redactSensitiveValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') {
    let safe = value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
      .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[REDACTED IMAGE DATA]')
    for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join('[REDACTED]')
    return safe.length > 4000 ? `${safe.slice(0, 4000)}…` : safe
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitiveValue(item, secrets))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => (
    SENSITIVE_KEY_PATTERN.test(key)
      ? [key, '[REDACTED]']
      : [key, redactSensitiveValue(item, secrets)]
  )))
}

async function persistDiagnosticSafely(
  token: string,
  dependencies: ScheduleImportDependencies,
  payload: DiagnosticPayload,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const id = await dependencies.recordDiagnostic(token, payload)
    return { id: UUID_PATTERN.test(id) ? id : null, error: UUID_PATTERN.test(id) ? null : 'The diagnostic log ID was invalid.' }
  } catch (caught) {
    return { id: null, error: safeErrorMessage(caught) }
  }
}

function allowedOrigin(request: Request): string {
  const origin = request.headers.get('Origin')?.trim()
  if (!origin) return PRODUCTION_ORIGIN
  if (origin === PRODUCTION_ORIGIN || LOCAL_ORIGINS.has(origin)) return origin
  throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed to use schedule importing.')
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

function jsonResponse(origin: string, status: number, body: unknown, retryAfter?: number): Response {
  const headers = new Headers(corsHeaders(origin))
  headers.set('Content-Type', 'application/json; charset=utf-8')
  if (retryAfter) headers.set('Retry-After', String(retryAfter))
  return new Response(JSON.stringify(body), { status, headers })
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) throw new HttpError(401, 'authentication_required', 'Sign in before importing a schedule screenshot.')
  return token
}

function toHttpError(caught: unknown): HttpError {
  if (caught instanceof HttpError) return caught
  const message = safeErrorMessage(caught)
  const lowered = message.toLowerCase()
  if (lowered.includes('rate_limit_exceeded')) {
    return new HttpError(429, 'rate_limit_exceeded', 'You have reached the schedule import limit. Try again later.')
  }
  if (lowered.includes('developer_mode_administrator_required') || lowered.includes('developer_mode_forbidden')) {
    return new HttpError(403, 'developer_mode_forbidden', 'Administrator access is required for AI developer mode.')
  }
  if (lowered.includes('developer_overrides_not_allowed')) {
    return new HttpError(403, 'developer_overrides_not_allowed', 'Model overrides require administrator developer mode.')
  }
  if (lowered.includes('model_not_enabled') || lowered.includes('model_incompatible') || lowered.includes('thinking_level_unsupported')) {
    return new HttpError(400, 'invalid_model_configuration', 'The selected Gemini model configuration is not enabled or compatible.')
  }
  return new HttpError(500, 'schedule_import_failure', 'Schedule importing failed unexpectedly.')
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string, errors: string[]): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${expected.join(', ')}.`)
  }
}

function optionalFormString(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_developer_option', 'A developer option was invalid.')
  const normalized = value.trim()
  return normalized || null
}

function safeErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return String(redactSensitiveValue(caught.message))
  return String(redactSensitiveValue(String(caught)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
}

function isAcademicTerm(value: unknown): value is Exclude<ImportTerm, 'unknown'> {
  return value === 'full_year' || value === 'semester_1' || value === 'semester_2'
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function validNormalizedSlots(slots: MeetingSlot[]): boolean {
  return Array.isArray(slots) && slots.length >= 1 && slots.length <= 4 && slots.every((slot) => (
    (slot.day_type === 'A' || slot.day_type === 'B')
    && Number.isInteger(slot.period_number)
    && slot.period_number >= 1
    && slot.period_number <= 9
  )) && uniqueSlots(slots).length === slots.length
}

function uniqueSlots(slots: MeetingSlot[]): MeetingSlot[] {
  return [...new Map(slots.map((slot) => [`${slot.day_type}:${slot.period_number}`, slot])).values()]
}

function sortSlots(slots: MeetingSlot[]): MeetingSlot[] {
  return [...slots].sort((left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number)
}

function slotsKey(slots: MeetingSlot[]): string {
  return sortSlots(slots).map((slot) => `${slot.day_type}${slot.period_number}`).join(',')
}
