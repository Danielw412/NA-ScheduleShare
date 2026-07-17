import type { AcademicTerm, ClassSearchResult, CourseNameSearchResult, MeetingSlot } from './domain'
import { hasMultiplePeriodsOnAnyDay, sortMeetingSlots, validateMeetingSlots } from './schedule'
import { createClassAndEnroll, enrollInClass, searchClasses } from './supabase/data'
import { supabase } from './supabase/client'
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

export class ScheduleImportRequestError extends Error {
  constructor(message: string, readonly developer?: ScheduleImportDeveloperDiagnostics) {
    super(message)
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const RESIZE_THRESHOLD_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2200

export async function prepareScheduleImage(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PNG, JPEG, or WebP image.')
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Each screenshot must be 5 MB or smaller.')
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

export async function submitScheduleScreenshots(
  files: File[],
  developerOptions: ScheduleImportDeveloperOptions = { enabled: false },
): Promise<ScheduleImportResult> {
  if (!supabase) throw new Error('Sign in before importing schedule screenshots.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Your session has expired. Refresh the page and sign in again.')
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

export function importRowError(row: EditableScheduleImportRow): string | null {
  if (!row.include) return null
  if (!row.course) return 'Choose an existing course from the catalogue.'
  if (row.term === 'unknown') return 'Choose the academic term.'
  const teacherError = teacherLastNameError(teacherForImportedCourse(row.teacher_last_name, row.course.name))
  if (teacherError) return teacherError
  return validateMeetingSlots(row.meeting_slots, hasMultiplePeriodsOnAnyDay(row.meeting_slots))
}

export async function confirmScheduleImport(rows: EditableScheduleImportRow[]): Promise<{ added: number; skipped: number }> {
  let added = 0
  let skipped = 0
  for (const row of rows) {
    if (!row.include) {
      skipped += 1
      continue
    }
    const validationError = importRowError(row)
    if (validationError || !row.course || row.term === 'unknown') throw new Error(validationError ?? 'Review every import row before saving.')

    const currentOptions = await findClassesForCourse({ id: row.course.id, course_name: row.course.name, score: 100 })
    const selected = row.selected_existing_class_id
      ? currentOptions.find((option) => option.id === row.selected_existing_class_id) ?? null
      : exactClassOption(row, currentOptions)
    if (selected) {
      await enrollInClass(selected.id, row.term)
      added += 1
      continue
    }

    try {
      await createClassAndEnroll({
        courseNameId: row.course.id,
        teacherLastName: teacherForImportedCourse(row.teacher_last_name, row.course.name),
        term: row.term,
        isDoublePeriod: hasMultiplePeriodsOnAnyDay(row.meeting_slots),
        meetingSlots: row.meeting_slots,
        confirmedNoCourseMatch: false,
      })
      added += 1
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ''
      if (!message.includes('exact_duplicate_class_section_exists')) throw caught
      const rechecked = await findClassesForCourse({ id: row.course.id, course_name: row.course.name, score: 100 })
      const duplicate = exactClassOption(row, rechecked)
      if (!duplicate) throw caught
      await enrollInClass(duplicate.id, row.term)
      added += 1
    }
  }
  return { added, skipped }
}

export function teacherForImportedCourse(teacherLastName: string, courseName?: string): string {
  const normalizedCourse = courseName?.trim().toLocaleLowerCase()
  if (normalizedCourse === 'lunch' || normalizedCourse === 'study hall') return 'N/A'
  return normalizeTeacherLastName(teacherLastName)
}

function slotsKey(slots: MeetingSlot[]): string {
  return sortMeetingSlots(slots).map((slot) => `${slot.day_type}${slot.period_number}`).join(',')
}
