import type { AcademicTerm, ClassSearchResult, CourseNameSearchResult, Grade, MeetingSlot, ScheduleEnrollment } from './domain'
import { formatMeetingSlotSummary, hasMultiplePeriodsOnAnyDay, sortMeetingSlots, validateMeetingSlots } from './schedule'
import { searchClasses, searchCourseNames, searchGuestClasses } from './supabase/data'
import { supabase } from './supabase/client'
import type { Json } from './supabase/database.types'
import { normalizeTeacherLastName, teacherLastNameError } from './teacher'

export type ImportTerm = AcademicTerm | 'unknown'
export type ImportFlag = 'low_confidence' | 'unresolved_course' | 'ambiguous_course' | 'duplicate' | 'incomplete'

export interface ImportClassOption {
  id: string
  course_id: string
  teacher_last_name: string
  term: AcademicTerm
  meeting_slots: MeetingSlot[]
}

export interface ScheduleImportRow {
  id: string
  source_course_name: string
  course: { id: string; name: string; confidence: number } | null
  teacher_last_name: string
  term: ImportTerm
  meeting_slots: MeetingSlot[]
  confidence: number
  warnings: string[]
  flags: ImportFlag[]
  resolution: 'existing_class' | 'new_class' | 'unresolved_course'
  existing_class_id: string | null
  class_options: ImportClassOption[]
}

export interface ScheduleImportResult {
  rows: ScheduleImportRow[]
  warnings: string[]
  image_count: number
  estimated_grade?: Grade
  shared_student_count?: number
  developer?: ScheduleImportDeveloperDiagnostics
}

export interface ScheduleImportDeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: 'minimal' | 'low' | 'medium' | 'high'
  output_token_limit: number
  timing_ms: number
  image_metadata: Array<{ index: number; mime_type: string; byte_size: number }>
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportDeveloperOptions {
  enabled: boolean
  modelId?: string
  thinkingLevel?: ScheduleImportDeveloperDiagnostics['thinking_level']
}

export interface EditableScheduleImportRow extends ScheduleImportRow {
  selected_existing_class_id: string | null
  include: boolean
}

export interface ScheduleImportErrorBody {
  error?: string
  message?: string
  developer?: ScheduleImportDeveloperDiagnostics
}

export function normalizeReviewTerm(value: unknown): AcademicTerm {
  if (typeof value !== 'string') return 'full_year'
  const normalized = value.trim().toLocaleLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ')
  if (/^(?:s1|sem(?:ester)?\s*1|first\s+semester|1st\s+semester)$/.test(normalized)) return 'semester_1'
  if (/^(?:s2|sem(?:ester)?\s*2|second\s+semester|2nd\s+semester)$/.test(normalized)) return 'semester_2'
  return 'full_year'
}

export class ScheduleImportRequestError extends Error {
  constructor(message: string, readonly developer?: ScheduleImportDeveloperDiagnostics) {
    super(message)
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_SCHEDULE_IMAGES = 3
const RESIZE_THRESHOLD_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2200

export async function prepareScheduleImage(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PNG, JPEG, or WebP image.')
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Each screenshot must be 10 MB or smaller.')
  if (file.size === 0) throw new Error('The selected screenshot is empty.')
  if (file.size < RESIZE_THRESHOLD_BYTES || typeof createImageBitmap !== 'function') return file

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < RESIZE_THRESHOLD_BYTES * 1.5) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!blob || blob.size >= file.size) return file
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'schedule'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

export function validateScheduleImageCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SCHEDULE_IMAGES) {
    throw new Error('Add between 1 and 3 schedule screenshots before analysis.')
  }
}

export async function submitScheduleScreenshots(
  files: File[],
  developerOptions: ScheduleImportDeveloperOptions = { enabled: false },
): Promise<ScheduleImportResult> {
  validateScheduleImageCount(files.length)
  if (!supabase) throw new Error('Schedule importing is not configured.')
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file, file.name))
  formData.set('developer_mode', String(developerOptions.enabled))
  if (developerOptions.enabled && developerOptions.modelId) formData.set('model', developerOptions.modelId)
  if (developerOptions.enabled && developerOptions.thinkingLevel) formData.set('thinking_level', developerOptions.thinkingLevel)

  try {
    const result = await supabase.functions.invoke('schedule-import', { body: formData })
    if (result.error) {
      const context = (result.error as unknown as { context?: unknown }).context
      const response = context instanceof Response ? context : null
      const errorBody = response
        ? await response.clone().json().catch(() => ({})) as ScheduleImportErrorBody
        : {}
      throw new ScheduleImportRequestError(
        errorBody.message || importErrorMessage(errorBody.error, response?.status ?? 0),
        errorBody.developer,
      )
    }
    if (!result.data || typeof result.data !== 'object') {
      throw new ScheduleImportRequestError('Schedule recognition returned an invalid response.')
    }
    return result.data as ScheduleImportResult
  } catch (caught) {
    if (caught instanceof ScheduleImportRequestError) throw caught
    throw new ScheduleImportRequestError('The schedule import service could not be reached. Your previews are still here so you can try again.')
  }
}

function importErrorMessage(code: string | undefined, status: number): string {
  if (code === 'schedule_periods_missing') return 'The screenshot shows classes but not their period numbers. Add an image that includes both the period column and course names.'
  if (code === 'session_expired' || status === 401) return 'Your session has expired. Refresh the page and sign in again.'
  if (code === 'rate_limit_exceeded' || status === 429) return 'You have reached the schedule import limit. Try again later.'
  if (code === 'ai_quota_exceeded') return 'Schedule recognition is temporarily at capacity. Try again later.'
  if (code === 'ai_timeout') return 'Schedule recognition timed out. Your previews are still here so you can try again.'
  if (code === 'developer_mode_forbidden') return 'Administrator access is required for AI developer mode.'
  if (code === 'invalid_model_configuration') return 'The selected Gemini model or reasoning setting is not enabled.'
  return 'The schedule could not be imported. Check the screenshots and try again.'
}

export async function findClassesForCourse(course: CourseNameSearchResult): Promise<ImportClassOption[]> {
  const results = await searchClasses({ query: course.course_name })
  return results
    .filter((result) => result.course_name_id === course.id)
    .map(classOptionFromSearch)
}

function classOptionFromSearch(result: ClassSearchResult): ImportClassOption {
  return {
    id: result.id,
    course_id: result.course_name_id,
    teacher_last_name: result.teacher_last_name,
    term: result.default_academic_term,
    meeting_slots: sortMeetingSlots(result.meeting_slots),
  }
}

export function exactClassOption(row: EditableScheduleImportRow, options = row.class_options): ImportClassOption | null {
  if (row.term === 'unknown') return null
  const slots = slotsKey(row.meeting_slots)
  const teacher = teacherForImportedCourse(row.teacher_last_name, row.course?.name).toLocaleLowerCase()
  return options.find((option) => (
    option.course_id === row.course?.id
    && option.term === row.term
    && normalizeTeacherLastName(option.teacher_last_name).toLocaleLowerCase() === teacher
    && slotsKey(option.meeting_slots) === slots
  )) ?? null
}

export function reconcileExactClassSelection(row: EditableScheduleImportRow): EditableScheduleImportRow {
  const exact = exactClassOption(row)
  const reconciled = exact
    ? {
        ...row,
        selected_existing_class_id: exact.id,
        resolution: 'existing_class' as const,
      }
    : {
        ...row,
        selected_existing_class_id: null,
        resolution: row.course ? 'new_class' as const : 'unresolved_course' as const,
      }

  if (importRowError(reconciled)) return reconciled
  return {
    ...reconciled,
    flags: reconciled.flags.filter((flag) => flag !== 'incomplete'),
  }
}

function academicTermLabel(term: AcademicTerm): string {
  if (term === 'full_year') return 'Full Year'
  if (term === 'semester_1') return 'Semester 1'
  return 'Semester 2'
}

export function importClassOptionLabel(option: ImportClassOption): string {
  const slots = formatMeetingSlotSummary(option.meeting_slots)
  return `Use ${option.teacher_last_name} · ${slots} · ${academicTermLabel(option.term)}`
}

export function importRowError(row: EditableScheduleImportRow): string | null {
  if (!row.include) return null
  if (!row.course) return 'Choose an existing course from the catalogue.'
  if (row.term === 'unknown') return 'Choose the academic term.'
  const teacherError = teacherLastNameError(teacherForImportedCourse(row.teacher_last_name, row.course.name))
  if (teacherError) return teacherError
  return validateMeetingSlots(row.meeting_slots, hasMultiplePeriodsOnAnyDay(row.meeting_slots))
}

interface ScheduleReplacementResult {
  added_count: number
  removed_count: number
}

function scheduleReplacementErrorMessage(error: { message?: string; details?: string; hint?: string }): string {
  const message = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (message.includes('PGRST202') || message.toLowerCase().includes('could not find the function')) return 'Schedule replacement is not available yet. An administrator must apply the latest database migration.'
  if (message.includes('import_schedule_conflict')) return 'The imported classes conflict with each other. Review their terms and meeting slots.'
  if (message.includes('import_existing_class_mismatch')) return 'An existing class changed while you were reviewing. Review the class action and try again.'
  if (message.includes('duplicate_import_class')) return 'The imported schedule includes the same class more than once.'
  if (message.includes('invalid_import_schedule')) return 'The imported schedule is incomplete or invalid. Review every selected class.'
  return error.message || 'The reviewed schedule could not be saved.'
}

export async function confirmScheduleImport(rows: EditableScheduleImportRow[]): Promise<{ added: number; removed: number }> {
  if (!supabase) throw new Error('Sign in before replacing your schedule.')
  const includedRows = rows.filter((row) => row.include)
  if (includedRows.length === 0) throw new Error('Select at least one class before replacing your schedule.')

  const semesterRows = includedRows.flatMap((row) => {
    if (specialCourseKind(row.course?.name) !== 'Lunch' || row.term !== 'full_year') return [row]
    return (['semester_1', 'semester_2'] as const).map((term) => reconcileExactClassSelection({ ...row, term }))
  })

  const replacementRows = semesterRows.map((row) => {
    const validationError = importRowError(row)
    if (validationError || !row.course || row.term === 'unknown') {
      throw new Error(validationError ?? 'Review every import row before saving.')
    }
    return {
      existing_class_id: row.selected_existing_class_id,
      course_name_id: row.course.id,
      teacher_last_name: teacherForImportedCourse(row.teacher_last_name, row.course.name),
      academic_term: row.term,
      meeting_slots: sortMeetingSlots(row.meeting_slots),
    }
  })

  const { data, error } = await supabase.rpc('replace_schedule_from_import', {
    p_rows: replacementRows as unknown as Json,
  })
  if (error) throw new Error(scheduleReplacementErrorMessage(error))

  const result = Array.isArray(data) ? data[0] : data
  if (!result || typeof result !== 'object') throw new Error('Schedule replacement returned an invalid response.')
  const added = Number((result as ScheduleReplacementResult).added_count)
  const removed = Number((result as ScheduleReplacementResult).removed_count)
  if (!Number.isInteger(added) || !Number.isInteger(removed)) throw new Error('Schedule replacement returned invalid counts.')
  if (added !== replacementRows.length) throw new Error(`Schedule replacement reported ${added} of ${replacementRows.length} reviewed classes. Reload the page before trying again.`)
  return { added, removed }
}

export function teacherForImportedCourse(teacherLastName: string, courseName?: string): string {
  if (specialCourseKind(courseName)) return 'N/A'
  return normalizeTeacherLastName(teacherLastName)
}

export function editableRowsFromImportResult(result: ScheduleImportResult): EditableScheduleImportRow[] {
  return result.rows.map((row) => {
    const savedReview = row as ScheduleImportRow & Partial<Pick<EditableScheduleImportRow, 'include' | 'selected_existing_class_id'>>
    return reconcileExactClassSelection({
      ...row,
      term: normalizeReviewTerm(row.term),
      selected_existing_class_id: savedReview.selected_existing_class_id ?? row.existing_class_id,
      include: savedReview.include ?? true,
    })
  })
}

export function scheduleImportPreviewEnrollments(result: ScheduleImportResult): ScheduleEnrollment[] {
  const timestamp = new Date().toISOString()
  return editableRowsFromImportResult(result).flatMap((row) => {
    if (!row.include || !row.course || row.term === 'unknown') return []
    const classId = row.selected_existing_class_id ?? `guest-preview-class:${row.id}`
    return [{
      id: `guest-preview-enrollment:${row.id}`,
      class_id: classId,
      student_id: 'guest-preview',
      academic_term: row.term,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
      class: {
        id: classId,
        course_name_id: row.course.id,
        course_name: row.course.name,
        teacher_last_name: teacherForImportedCourse(row.teacher_last_name, row.course.name),
        default_academic_term: row.term,
        is_double_period: hasMultiplePeriodsOnAnyDay(row.meeting_slots),
        meeting_slots: sortMeetingSlots(row.meeting_slots),
      },
    }]
  })
}

export async function findGuestClassesForCourse(course: CourseNameSearchResult): Promise<ImportClassOption[]> {
  const results = await searchGuestClasses({ query: course.course_name, limit: 1000 })
  return results
    .filter((result) => result.course_name_id === course.id)
    .map(classOptionFromSearch)
}

export function specialCourseKind(courseName?: string): 'Lunch' | 'Study Hall' | null {
  const normalized = courseName?.trim().toLocaleLowerCase().replace(/\s*-\s*/g, ' ')
  if (normalized === 'lunch' || normalized === 'lunch nai' || normalized === 'lunch nash') return 'Lunch'
  if (normalized === 'study hall' || normalized === 'study hall nai' || normalized === 'study hall nash') return 'Study Hall'
  return null
}

export function campusCourseName(kind: 'Lunch' | 'Study Hall', grade: Grade): string {
  return `${kind} - ${grade <= 10 ? 'NAI' : 'NASH'}`
}

export async function normalizeImportedResultForGrade(result: ScheduleImportResult, grade: Grade): Promise<ScheduleImportResult> {
  const rows = await Promise.all(result.rows.map(async (row) => {
    const kind = specialCourseKind(row.course?.name ?? row.source_course_name)
    if (!kind) return row
    const targetName = campusCourseName(kind, grade)
    const courses = await searchCourseNames(targetName)
    const course = courses.find((candidate) => candidate.course_name.toLocaleLowerCase() === targetName.toLocaleLowerCase())
    if (!course) throw new Error(`The ${targetName} catalog entry is unavailable.`)
    const classOptions = await findClassesForCourse(course)
    const reconciled = reconcileExactClassSelection({
      ...row,
      source_course_name: targetName,
      course: { id: course.id, name: course.course_name, confidence: 1 },
      teacher_last_name: 'N/A',
      class_options: classOptions,
      existing_class_id: null,
      selected_existing_class_id: null,
      include: (row as Partial<EditableScheduleImportRow>).include ?? true,
    })
    return {
      ...reconciled,
      existing_class_id: reconciled.selected_existing_class_id,
    }
  }))
  return { ...result, rows }
}

const GUEST_IMPORT_DRAFT_KEY = 'scheduleshare:guest-import-draft:v1'
const GUEST_IMPORT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function saveGuestScheduleImportDraft(result: ScheduleImportResult): void {
  const value = JSON.stringify({ saved_at: Date.now(), result })
  try {
    window.localStorage.setItem(GUEST_IMPORT_DRAFT_KEY, value)
    window.sessionStorage.removeItem(GUEST_IMPORT_DRAFT_KEY)
    return
  } catch {
    try {
      window.sessionStorage.setItem(GUEST_IMPORT_DRAFT_KEY, value)
    } catch {
      // The in-memory page preview still works when browser storage is unavailable.
    }
  }
}

export function loadGuestScheduleImportDraft(): ScheduleImportResult | null {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(GUEST_IMPORT_DRAFT_KEY)
  } catch {
    // Fall back to the current tab's storage below.
  }
  if (!stored) {
    try {
      stored = window.sessionStorage.getItem(GUEST_IMPORT_DRAFT_KEY)
    } catch {
      return null
    }
  }
  try {
    const parsed = JSON.parse(stored ?? 'null') as {
      saved_at?: unknown
      result?: ScheduleImportResult
    } | null
    if (!parsed || typeof parsed.saved_at !== 'number' || Date.now() - parsed.saved_at > GUEST_IMPORT_DRAFT_MAX_AGE_MS) {
      clearGuestScheduleImportDraft()
      return null
    }
    if (!parsed.result || !Array.isArray(parsed.result.rows) || parsed.result.rows.length < 1 || parsed.result.rows.length > 30) return null
    return parsed.result
  } catch {
    return null
  }
}

export function clearGuestScheduleImportDraft(): void {
  try {
    window.localStorage.removeItem(GUEST_IMPORT_DRAFT_KEY)
  } catch {
    // Continue clearing the tab fallback.
  }
  try {
    window.sessionStorage.removeItem(GUEST_IMPORT_DRAFT_KEY)
  } catch {
    // Expiration will make any inaccessible copy unusable after 24 hours.
  }
}

function slotsKey(slots: MeetingSlot[]): string {
  return sortMeetingSlots(slots).map((slot) => `${slot.day_type}${slot.period_number}`).join(',')
}
