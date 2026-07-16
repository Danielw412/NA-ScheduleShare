import type { AcademicTerm, ClassSearchResult, CourseNameSearchResult, MeetingSlot } from './domain'
import { hasMultiplePeriodsOnAnyDay, sortMeetingSlots, validateMeetingSlots } from './schedule'
import { createClassAndEnroll, enrollInClass, searchClasses } from './supabase/data'
import { supabase } from './supabase/client'
import { normalizeTeacherLastName, teacherLastNameError } from './teacher'

export type ImportTerm = AcademicTerm | 'unknown'
export type ImportFlag = 'low_confidence' | 'unresolved_course' | 'duplicate' | 'incomplete'

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
}

export interface EditableScheduleImportRow extends ScheduleImportRow {
  selected_existing_class_id: string | null
  include: boolean
}

export interface ScheduleImportErrorBody {
  error?: string
  message?: string
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

export async function submitScheduleScreenshots(files: File[]): Promise<ScheduleImportResult> {
  const endpoint = import.meta.env.VITE_SCHEDULE_IMPORT_API_URL?.trim()
  if (!endpoint) throw new Error('Schedule importing is not configured yet.')
  if (!supabase) throw new Error('Sign in before importing schedule screenshots.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Your session has expired. Refresh the page and sign in again.')
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file, file.name))
  let response: Response
  try {
    response = await fetch(`${endpoint.replace(/\/$/, '')}/api/schedule-import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: formData,
    })
  } catch {
    throw new Error('The schedule import service could not be reached. Your previews are still here so you can try again.')
  }
  const body = await response.json().catch(() => ({})) as ScheduleImportErrorBody | ScheduleImportResult
  if (!response.ok) {
    const errorBody = body as ScheduleImportErrorBody
    throw new Error(errorBody.message || importErrorMessage(errorBody.error, response.status))
  }
  return body as ScheduleImportResult
}

function importErrorMessage(code: string | undefined, status: number): string {
  if (code === 'schedule_periods_missing') return 'The screenshot shows classes but not their period numbers. Add an image that includes both the period column and course names.'
  if (code === 'session_expired' || status === 401) return 'Your session has expired. Refresh the page and sign in again.'
  if (code === 'rate_limit_exceeded' || status === 429) return 'You have reached the schedule import limit. Try again later.'
  if (code === 'ai_quota_exceeded') return 'Schedule recognition is temporarily at capacity. Try again later.'
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
