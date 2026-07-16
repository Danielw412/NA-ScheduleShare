const MODEL = '@cf/moondream/moondream3.1-9B-A2B'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGES = 2
const DEFAULT_RATE_LIMIT = 6
const DEFAULT_RATE_WINDOW_SECONDS = 60 * 60
const MAX_CATALOG_PROMPT_CHARS = 60_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PRODUCTION_ORIGIN = 'https://danielw412.github.io'
const LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

type DayType = 'A' | 'B'
type ImportTerm = 'full_year' | 'semester_1' | 'semester_2' | 'unknown'

interface MeetingSlot {
  day_type: DayType
  period_number: number
}

interface CourseRecord {
  id: string
  name: string
}

interface ExistingClassRecord {
  id: string
  course_name_id: string
  teacher_last_name: string
  default_academic_term: Exclude<ImportTerm, 'unknown'>
  is_double_period: boolean
  class_meeting_slots: MeetingSlot[]
}

interface AiEntry {
  source_course_name: string
  teacher_raw: string
  term: ImportTerm
  meeting_slots: MeetingSlot[]
  confidence: number
  warnings: string[]
  course_id: string | null
  canonical_course_name: string | null
  course_match_confidence: number
}

interface AiScheduleResult {
  schedule_detected: boolean
  period_mapping_visible: boolean
  image_quality: 'clear' | 'usable' | 'unusable'
  warnings: string[]
  entries: AiEntry[]
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
  flags: Array<'low_confidence' | 'unresolved_course' | 'duplicate' | 'incomplete'>
  resolution: 'existing_class' | 'new_class' | 'unresolved_course'
  existing_class_id: string | null
  class_options: ImportClassOption[]
}

export interface ScheduleImportResponse {
  rows: ImportReviewRow[]
  warnings: string[]
  image_count: number
}

interface MoondreamQueryInput {
  task: 'query'
  image: Uint8Array
  question: string
  reasoning: boolean
  temperature: number
  max_tokens: number
  stream: boolean
}

interface AiBinding {
  run(model: string, input: MoondreamQueryInput): Promise<unknown>
}

interface KvBinding {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface Env {
  AI: AiBinding
  RATE_LIMIT: KvBinding
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  RATE_LIMIT_MAX?: string
  RATE_LIMIT_WINDOW_SECONDS?: string
}

interface RequestContext {
  now?: () => number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
}

function jsonResponse(origin: string, status: number, body: unknown, retryAfter?: number): Response {
  const headers = new Headers(corsHeaders(origin))
  headers.set('Content-Type', 'application/json; charset=utf-8')
  if (retryAfter) headers.set('Retry-After', String(retryAfter))
  return new Response(JSON.stringify(body), { status, headers })
}

function getOrigin(request: Request): string {
  const origin = request.headers.get('Origin') ?? ''
  if (origin !== PRODUCTION_ORIGIN && !LOCAL_ORIGINS.has(origin)) {
    throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed to use schedule importing.')
  }
  return origin
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) {
    throw new HttpError(401, 'authentication_required', 'Sign in before importing a schedule screenshot.')
  }
  return match[1]
}

function supabaseHeaders(env: Env, token: string): HeadersInit {
  return {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function configuredSupabaseUrl(env: Env): string {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, '')
  if (!url || !env.SUPABASE_PUBLISHABLE_KEY?.trim()) {
    throw new HttpError(503, 'worker_not_configured', 'Schedule importing is not configured yet.')
  }
  return url
}

async function authenticate(request: Request, env: Env): Promise<{ token: string; userId: string }> {
  const token = getBearerToken(request)
  const url = configuredSupabaseUrl(env)
  let response: Response
  try {
    response = await fetch(`${url}/auth/v1/user`, { headers: supabaseHeaders(env, token) })
  } catch {
    throw new HttpError(503, 'authentication_unavailable', 'The session could not be verified. Try again shortly.')
  }
  if (!response.ok) {
    throw new HttpError(401, 'session_expired', 'Your session has expired. Refresh the page and sign in again.')
  }
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) {
    throw new HttpError(401, 'session_invalid', 'The session response could not be verified.')
  }
  return { token, userId: body.id }
}

async function consumeRateLimit(env: Env, userId: string, now: number): Promise<void> {
  if (!env.RATE_LIMIT) throw new HttpError(503, 'worker_not_configured', 'Schedule importing rate limits are not configured.')
  const maximum = positiveInteger(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT)
  const windowSeconds = positiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_WINDOW_SECONDS)
  const windowStart = Math.floor(now / (windowSeconds * 1000))
  const key = `schedule-import:${userId}:${windowStart}`
  const current = Number(await env.RATE_LIMIT.get(key) ?? '0')
  if (Number.isFinite(current) && current >= maximum) {
    const retryAfter = windowSeconds - Math.floor((now / 1000) % windowSeconds)
    throw new HttpError(429, 'rate_limit_exceeded', 'You have reached the schedule import limit. Try again later.', retryAfter)
  }
  await env.RATE_LIMIT.put(key, String(Number.isFinite(current) ? current + 1 : 1), {
    expirationTtl: windowSeconds + 60,
  })
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function readImages(request: Request): Promise<File[]> {
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
  const images = formData.getAll('images').filter((value): value is File => value instanceof File)
  if (images.length < 1 || images.length > MAX_IMAGES) {
    throw new HttpError(400, 'invalid_image_count', 'Upload one or two schedule screenshots.')
  }
  for (const image of images) {
    if (!IMAGE_TYPES.has(image.type.toLowerCase())) {
      throw new HttpError(415, 'unsupported_file_type', 'Use a PNG, JPEG, or WebP image.')
    }
    if (image.size <= 0) throw new HttpError(400, 'empty_file', 'One of the screenshots is empty.')
    if (image.size > MAX_IMAGE_BYTES) {
      throw new HttpError(413, 'image_too_large', 'Each screenshot must be 5 MB or smaller.')
    }
  }
  return images
}

async function fetchCatalog(env: Env, token: string): Promise<CourseRecord[]> {
  const url = configuredSupabaseUrl(env)
  const body = await fetchAllPages(`${url}/rest/v1/course_names?select=id,name&status=eq.active&order=name`, env, token, 'catalog')
  const courses = body.filter((value): value is CourseRecord => (
    isRecord(value) && typeof value.id === 'string' && UUID_PATTERN.test(value.id)
    && typeof value.name === 'string' && value.name.trim().length >= 2
  ))
  if (courses.length === 0) {
    throw new HttpError(403, 'catalog_forbidden', 'Your account cannot access schedule importing.')
  }
  return courses
}

async function fetchExistingClasses(env: Env, token: string): Promise<ExistingClassRecord[]> {
  const url = configuredSupabaseUrl(env)
  const select = encodeURIComponent('id,course_name_id,teacher_last_name,default_academic_term,is_double_period,class_meeting_slots(day_type,period_number)')
  const body = await fetchAllPages(`${url}/rest/v1/classes?select=${select}&status=eq.active&order=id`, env, token, 'classes')
  return body.flatMap((value) => {
    if (!isRecord(value)
      || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)
      || typeof value.course_name_id !== 'string' || !UUID_PATTERN.test(value.course_name_id)
      || typeof value.teacher_last_name !== 'string'
      || !isAcademicTerm(value.default_academic_term)
      || typeof value.is_double_period !== 'boolean'
      || !Array.isArray(value.class_meeting_slots)) return []
    const slots = parseSlots(value.class_meeting_slots)
    if (!slots) return []
    return [{
      id: value.id,
      course_name_id: value.course_name_id,
      teacher_last_name: value.teacher_last_name,
      default_academic_term: value.default_academic_term,
      is_double_period: value.is_double_period,
      class_meeting_slots: slots,
    }]
  })
}

async function fetchAllPages(
  url: string,
  env: Env,
  token: string,
  resource: 'catalog' | 'classes',
): Promise<unknown[]> {
  const pageSize = 1_000
  const rows: unknown[] = []
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const headers = new Headers(supabaseHeaders(env, token))
    headers.set('Range', `${offset}-${offset + pageSize - 1}`)
    const response = await fetch(url, { headers })
    if (response.status === 401) throw new HttpError(401, 'session_expired', 'Your session has expired. Refresh and sign in again.')
    if (!response.ok) {
      throw new HttpError(503, `${resource}_unavailable`, resource === 'catalog'
        ? 'The course catalogue is temporarily unavailable.'
        : 'Existing classes are temporarily unavailable.')
    }
    const body: unknown = await response.json()
    if (!Array.isArray(body)) {
      throw new HttpError(502, `${resource}_invalid`, resource === 'catalog'
        ? 'The course catalogue response was malformed.'
        : 'The existing-class response was malformed.')
    }
    rows.push(...body)
    if (body.length < pageSize) return rows
  }
  throw new HttpError(503, `${resource}_too_large`, resource === 'catalog'
    ? 'The course catalogue is too large to import safely.'
    : 'The class list is too large to import safely.')
}

function buildPrompt(catalog: CourseRecord[], candidatesOnly = false): string {
  const catalogLines = catalog.map((course) => `${course.id} | ${course.name}`).join('\n')
  return `You are reading one screenshot that is one whole or partial view of the same PowerSchool student schedule. Return ONLY one JSON object with exactly this shape:
{"schedule_detected":boolean,"period_mapping_visible":boolean,"image_quality":"clear"|"usable"|"unusable","warnings":string[],"entries":[{"source_course_name":string,"teacher_raw":string,"term":"full_year"|"semester_1"|"semester_2"|"unknown","meeting_slots":[{"day_type":"A"|"B","period_number":1-9}],"confidence":0-1,"warnings":string[],"course_id":string|null,"canonical_course_name":string|null,"course_match_confidence":0-1}]}

Rules:
- Read only rows where the visible course name can be associated with its visible Exp/period text. Never infer periods from row order or position.
- P01(A-B) means A1 and B1. P03(A) means A3. P06(B) means B6. P05(B) P06(A-B) means B5, A6, B6. P08(A-B) P09(A) means A8, B8, A9.
- Preserve each individual A/B meeting slot. Include rows with no slots only when a course is visible but its period mapping is cropped or unreadable; this lets the server reject incomplete combined images.
- Ignore grade level, case manager, counselor, attendance, room, email link, student name, and student ID rows.
- teacher_raw should contain the visible teacher text, reconstructed across line wraps. Do not guess a teacher.
- PowerSchool teacher text is usually Last, First. Lunch and Study Hall still need entries but should be matched only to their catalogue entries.
- Term is full_year for year text such as 25-26, semester_1 for S1/SEM 1, semester_2 for S2/SEM 2, otherwise unknown.
- course_id and canonical_course_name must either be an exact pair from the supplied active catalogue or both null. Never invent, rename, or create a course. Use null for ambiguous or weak matches.
- Handle common visible abbreviations and decorations such as Hon/Honors, AP, CHS, punctuation, spacing, and line wrapping, but do not match vaguely similar names.
- period_mapping_visible is true only when this image visibly connects at least one included course to explicit period and A/B information.
- schedule_detected is false for unrelated images. image_quality is unusable for blur, obstruction, or incompleteness that prevents reliable extraction.
${candidatesOnly ? 'The catalogue below contains fuzzy candidates generated for the visible text. Choose only a reliable pair.' : 'The complete active course catalogue follows.'}
ACTIVE CATALOGUE:
${catalogLines}`
}

async function fileToImageBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

async function runAi(
  env: Env,
  image: Uint8Array,
  prompt: string,
): Promise<AiScheduleResult> {
  let output: unknown
  try {
    output = await env.AI.run(MODEL, {
      task: 'query',
      image,
      question: prompt,
      reasoning: false,
      temperature: 0,
      max_tokens: 8_000,
      stream: false,
    })
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error)

    console.error('Workers AI invocation failed:', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    const normalized = message.toLowerCase()

    if (
      normalized.includes('quota')
      || normalized.includes('rate limit')
      || normalized.includes('429')
    ) {
      throw new HttpError(
        503,
        'ai_quota_exceeded',
        'Schedule recognition is temporarily at capacity. Try again later.',
      )
    }

    throw new HttpError(
      503,
      'ai_unavailable',
      'Schedule recognition is temporarily unavailable.',
    )
  }
  if (!isRecord(output) || typeof output.answer !== 'string') {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned an invalid response.')
  }
  return parseAiSchedule(output.answer)
}

async function extractImage(env: Env, file: File, catalog: CourseRecord[]): Promise<AiScheduleResult> {
  const image = await fileToImageBytes(file)
  const completePrompt = buildPrompt(catalog)
  if (completePrompt.length <= MAX_CATALOG_PROMPT_CHARS) return runAi(env, image, completePrompt)

  const firstPass = await runAi(env, image, buildPrompt([], false))
  const candidates = uniqueCourses(firstPass.entries.flatMap((entry) => fuzzyCandidates(entry.source_course_name, catalog, 8)))
  if (candidates.length === 0) return firstPass
  return runAi(env, image, buildPrompt(candidates, true))
}

function parseAiSchedule(answer: string): AiScheduleResult {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned malformed data.')
  }
  if (!isRecord(value) || !hasExactKeys(value, ['schedule_detected', 'period_mapping_visible', 'image_quality', 'warnings', 'entries'])) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned data with an unexpected shape.')
  }
  if (typeof value.schedule_detected !== 'boolean' || typeof value.period_mapping_visible !== 'boolean'
    || !['clear', 'usable', 'unusable'].includes(String(value.image_quality))
    || !isStringArray(value.warnings) || !Array.isArray(value.entries) || value.entries.length > 30) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned data with invalid fields.')
  }
  const entries = value.entries.map(parseAiEntry)
  return {
    schedule_detected: value.schedule_detected,
    period_mapping_visible: value.period_mapping_visible,
    image_quality: value.image_quality as AiScheduleResult['image_quality'],
    warnings: value.warnings,
    entries,
  }
}

function parseAiEntry(value: unknown): AiEntry {
  const keys = ['source_course_name', 'teacher_raw', 'term', 'meeting_slots', 'confidence', 'warnings', 'course_id', 'canonical_course_name', 'course_match_confidence']
  if (!isRecord(value) || !hasExactKeys(value, keys)
    || typeof value.source_course_name !== 'string' || value.source_course_name.trim().length < 2
    || value.source_course_name.length > 160 || typeof value.teacher_raw !== 'string' || value.teacher_raw.length > 200
    || !isImportTerm(value.term) || !Array.isArray(value.meeting_slots)
    || typeof value.confidence !== 'number' || !inConfidenceRange(value.confidence)
    || !isStringArray(value.warnings) || value.warnings.some((warning) => warning.length > 300)
    || !(value.course_id === null || (typeof value.course_id === 'string' && UUID_PATTERN.test(value.course_id)))
    || !(value.canonical_course_name === null || (typeof value.canonical_course_name === 'string' && value.canonical_course_name.length <= 120))
    || typeof value.course_match_confidence !== 'number' || !inConfidenceRange(value.course_match_confidence)) {
    throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned an invalid class entry.')
  }
  const meetingSlots = parseSlots(value.meeting_slots)
  if (!meetingSlots) throw new HttpError(502, 'ai_invalid_response', 'Schedule recognition returned invalid meeting slots.')
  return {
    source_course_name: collapseWhitespace(value.source_course_name),
    teacher_raw: collapseWhitespace(value.teacher_raw),
    term: value.term,
    meeting_slots: meetingSlots,
    confidence: value.confidence,
    warnings: value.warnings,
    course_id: value.course_id,
    canonical_course_name: value.canonical_course_name,
    course_match_confidence: value.course_match_confidence,
  }
}

function parseSlots(values: unknown[]): MeetingSlot[] | null {
  const slots: MeetingSlot[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, ['day_type', 'period_number'])
      || !isDayType(value.day_type) || !Number.isInteger(value.period_number)
      || Number(value.period_number) < 1 || Number(value.period_number) > 9) return null
    const key = `${value.day_type}:${value.period_number}`
    if (seen.has(key)) continue
    seen.add(key)
    slots.push({ day_type: value.day_type, period_number: Number(value.period_number) })
  }
  return sortSlots(slots)
}

export function parseTeacherLastName(raw: string, courseName = ''): string {
  const normalizedCourse = normalizeCourseName(courseName)
  if (normalizedCourse === 'lunch' || normalizedCourse === 'study hall') return 'N/A'
  let teacher = collapseWhitespace(raw)
    .replace(/^email\s+/i, '')
    .replace(/\s*-\s*rm\s*:\s*.*$/i, '')
    .replace(/\s+room\s*:?.*$/i, '')
    .trim()
  if (/^staff\s*,\s*unassigned$/i.test(teacher) || /^staff\s+unassigned$/i.test(teacher) || !teacher) return 'N/A'
  teacher = teacher.split(',')[0]?.trim() ?? ''
  return teacher || 'N/A'
}

function normalizeCourseName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\(\s*chs\s*\)/g, ' ')
    .replace(/\(\s*(?:sem(?:ester)?\s*[12]|s[12]|fy\s*\/\s*pt)\s*\)\s*\d*/g, ' ')
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
}

function courseSimilarity(left: string, right: string): number {
  const a = normalizeCourseName(left)
  const b = normalizeCourseName(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const leftTokens = new Set(a.split(' '))
  const rightTokens = new Set(b.split(' '))
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1
  const dice = (2 * shared) / (leftTokens.size + rightTokens.size)
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  const containment = a.includes(b) || b.includes(a) ? 0.88 : 0
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

function fuzzyCandidates(sourceName: string, catalog: CourseRecord[], limit: number): CourseRecord[] {
  return catalog
    .map((course) => ({ course, score: courseSimilarity(sourceName, course.name) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ course }) => course)
}

function uniqueCourses(courses: CourseRecord[]): CourseRecord[] {
  return [...new Map(courses.map((course) => [course.id, course])).values()]
}

function validatedCourseMatch(entry: AiEntry, catalog: CourseRecord[]): { course: CourseRecord; confidence: number } | null {
  const byId = new Map(catalog.map((course) => [course.id, course]))
  if (entry.course_id && entry.canonical_course_name) {
    const course = byId.get(entry.course_id)
    const similarity = course ? courseSimilarity(entry.source_course_name, course.name) : 0
    if (course && course.name === entry.canonical_course_name && entry.course_match_confidence >= 0.78 && similarity >= 0.72) {
      return { course, confidence: Math.min(entry.course_match_confidence, Math.max(similarity, 0.8)) }
    }
  }
  const ranked = catalog
    .map((course) => ({ course, score: courseSimilarity(entry.source_course_name, course.name) }))
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  const margin = best ? best.score - (ranked[1]?.score ?? 0) : 0
  if (best && ((best.score >= 0.93 && margin >= 0.03) || (best.score >= 0.86 && margin >= 0.08))) {
    return { course: best.course, confidence: best.score }
  }
  return null
}

function entryMergeKey(entry: AiEntry, catalog: CourseRecord[]): string {
  const course = validatedCourseMatch(entry, catalog)?.course
  const term = entry.term
  const teacher = parseTeacherLastName(entry.teacher_raw, course?.name ?? entry.source_course_name).toLowerCase()
  return `${course?.id ?? normalizeCourseName(entry.source_course_name)}|${teacher}|${term}`
}

function mergeEntries(results: AiScheduleResult[], catalog: CourseRecord[]): Array<AiEntry & { duplicate: boolean }> {
  const merged = new Map<string, AiEntry & { duplicate: boolean }>()
  for (const entry of results.flatMap((result) => result.entries)) {
    const key = entryMergeKey(entry, catalog)
    const current = merged.get(key)
    if (!current) {
      merged.set(key, { ...entry, meeting_slots: sortSlots(entry.meeting_slots), duplicate: false })
      continue
    }
    merged.set(key, {
      ...current,
      meeting_slots: sortSlots(uniqueSlots([...current.meeting_slots, ...entry.meeting_slots])),
      confidence: Math.max(current.confidence, entry.confidence),
      course_match_confidence: Math.max(current.course_match_confidence, entry.course_match_confidence),
      warnings: [...new Set([...current.warnings, ...entry.warnings, 'Duplicate or overlapping screenshot entry merged.'])],
      duplicate: true,
    })
  }
  return [...merged.values()]
}

function classOptionsFor(courseId: string, classes: ExistingClassRecord[]): ImportClassOption[] {
  return classes
    .filter((classRecord) => classRecord.course_name_id === courseId)
    .map((classRecord) => ({
      id: classRecord.id,
      course_id: classRecord.course_name_id,
      teacher_last_name: classRecord.teacher_last_name,
      term: classRecord.default_academic_term,
      meeting_slots: sortSlots(classRecord.class_meeting_slots),
    }))
}

function exactClassMatch(entry: AiEntry, courseName: string, options: ImportClassOption[]): ImportClassOption | null {
  if (entry.term === 'unknown') return null
  const teacher = parseTeacherLastName(entry.teacher_raw, courseName)
  const slotKey = slotsKey(entry.meeting_slots)
  return options.find((option) => (
    option.teacher_last_name.toLocaleLowerCase() === teacher.toLocaleLowerCase()
    && option.term === entry.term
    && slotsKey(option.meeting_slots) === slotKey
  )) ?? null
}

function buildReviewRows(
  results: AiScheduleResult[],
  catalog: CourseRecord[],
  classes: ExistingClassRecord[],
): ImportReviewRow[] {
  const entries = mergeEntries(results, catalog)
  if (entries.length === 0) {
    throw new HttpError(422, 'schedule_unreadable', 'No schedule classes with visible period information could be read.')
  }
  const incomplete = entries.find((entry) => entry.meeting_slots.length === 0)
  if (incomplete) {
    throw new HttpError(422, 'schedule_periods_missing', 'The screenshot shows classes but not their period numbers. Upload an image that includes both the period column and course names.')
  }
  return entries.map((entry, index) => {
    const match = validatedCourseMatch(entry, catalog)
    const options = match ? classOptionsFor(match.course.id, classes) : []
    const existing = match ? exactClassMatch(entry, match.course.name, options) : null
    const flags: ImportReviewRow['flags'] = []
    if (entry.confidence < 0.75 || (match && match.confidence < 0.82)) flags.push('low_confidence')
    if (!match) flags.push('unresolved_course')
    if (entry.duplicate) flags.push('duplicate')
    if (entry.term === 'unknown') flags.push('incomplete')
    return {
      id: `import-${index + 1}-${hashString(entryMergeKey(entry, catalog))}`,
      source_course_name: entry.source_course_name,
      course: match ? { id: match.course.id, name: match.course.name, confidence: match.confidence } : null,
      teacher_last_name: parseTeacherLastName(entry.teacher_raw, match?.course.name ?? entry.source_course_name),
      term: entry.term,
      meeting_slots: sortSlots(entry.meeting_slots),
      confidence: entry.confidence,
      warnings: entry.warnings,
      flags,
      resolution: !match ? 'unresolved_course' : existing ? 'existing_class' : 'new_class',
      existing_class_id: existing?.id ?? null,
      class_options: options,
    }
  })
}

function validateCombinedImages(results: AiScheduleResult[]): void {
  if (results.some((result) => !result.schedule_detected)) {
    throw new HttpError(422, 'schedule_not_detected', 'One of the images does not appear to be a PowerSchool schedule.')
  }
  if (results.some((result) => result.image_quality === 'unusable')) {
    throw new HttpError(422, 'schedule_image_unusable', 'One of the screenshots is too blurry, obstructed, or incomplete to read reliably.')
  }
  if (!results.some((result) => result.period_mapping_visible)) {
    throw new HttpError(422, 'schedule_periods_missing', 'The screenshot shows classes but not their period numbers. Upload an image that includes both the period column and course names.')
  }
}

async function importSchedule(request: Request, env: Env, context: RequestContext): Promise<ScheduleImportResponse> {
  const [{ token, userId }, images] = await Promise.all([authenticate(request, env), readImages(request)])
  await consumeRateLimit(env, userId, (context.now ?? Date.now)())
  const [catalog, classes] = await Promise.all([fetchCatalog(env, token), fetchExistingClasses(env, token)])
  const results = await Promise.all(images.map((image) => extractImage(env, image, catalog)))
  validateCombinedImages(results)
  return {
    rows: buildReviewRows(results, catalog, classes),
    warnings: [...new Set(results.flatMap((result) => result.warnings))],
    image_count: images.length,
  }
}

export async function handleRequest(request: Request, env: Env, context: RequestContext = {}): Promise<Response> {
  let origin = ''
  try {
    origin = getOrigin(request)
    const url = new URL(request.url)
    if (url.pathname !== '/api/schedule-import') {
      return jsonResponse(origin, 404, { error: 'not_found', message: 'Endpoint not found.' })
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (request.method !== 'POST') {
      return jsonResponse(origin, 405, { error: 'method_not_allowed', message: 'Use POST for schedule importing.' })
    }
    const result = await importSchedule(request, env, context)
    return jsonResponse(origin, 200, result)
  } catch (error) {
    const caught = error instanceof HttpError
      ? error
      : new HttpError(500, 'worker_failure', 'Schedule importing failed unexpectedly.')
    const safeOrigin = origin || PRODUCTION_ORIGIN
    return jsonResponse(safeOrigin, caught.status, { error: caught.code, message: caught.message }, caught.retryAfter)
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isDayType(value: unknown): value is DayType {
  return value === 'A' || value === 'B'
}

function isAcademicTerm(value: unknown): value is Exclude<ImportTerm, 'unknown'> {
  return value === 'full_year' || value === 'semester_1' || value === 'semester_2'
}

function isImportTerm(value: unknown): value is ImportTerm {
  return isAcademicTerm(value) || value === 'unknown'
}

function inConfidenceRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
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

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
