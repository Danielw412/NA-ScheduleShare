import type {
  AcademicTerm,
  ClassDefinition,
  ClassmateResult,
  ClassMemberResult,
  ClassSearchResult,
  DayType,
  HistoryRecord,
  MeetingSlot,
  ScheduleEnrollment,
  StudentDirectoryResult,
} from '../domain'
import { supabase } from './client'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function slotsFrom(value: unknown): MeetingSlot[] {
  if (!Array.isArray(value)) return []
  return value.map((slot) => {
    const row = slot as Record<string, unknown>
    return { day_type: row.day_type as DayType, period_number: Number(row.period_number) }
  })
}

export interface ClassSearchInput {
  query: string
  dayType?: DayType
  period?: number
}

function safeClassSearchError(error: { code?: string; message?: string }) {
  if (error.code === 'PGRST301' || error.message?.toLowerCase().includes('jwt')) {
    return 'Your session could not be verified. Refresh the page and sign in again.'
  }
  return 'Class search is temporarily unavailable. Please try again.'
}

export async function fetchSchedule(studentId: string): Promise<ScheduleEnrollment[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('class_enrollments')
    .select('id, student_id, class_id, academic_term, active, created_at, updated_at, classes!inner(id, class_name, teacher_name, default_academic_term, is_double_period, class_meeting_slots(day_type, period_number))')
    .eq('student_id', studentId)
    .eq('active', true)
    .order('created_at')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => {
    const classRow = row.classes as Record<string, unknown>
    return {
      id: row.id as string,
      student_id: row.student_id as string,
      class_id: row.class_id as string,
      academic_term: row.academic_term as AcademicTerm,
      active: Boolean(row.active),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      class: {
        id: classRow.id as string,
        class_name: classRow.class_name as string,
        teacher_name: classRow.teacher_name as string,
        default_academic_term: classRow.default_academic_term as AcademicTerm,
        is_double_period: Boolean(classRow.is_double_period),
        meeting_slots: slotsFrom(classRow.class_meeting_slots),
      },
    }
  })
}

export async function fetchHistory(studentId: string, limit = 10): Promise<HistoryRecord[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('schedule_change_history')
    .select('id, action, previous_value, new_value, changed_by, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as unknown as HistoryRecord[]
}

export async function searchClasses(input: ClassSearchInput, signal?: AbortSignal): Promise<ClassSearchResult[]> {
  const client = requireClient()
  const request = client.rpc('search_classes', {
    p_query: input.query,
    p_day_type: input.dayType ?? null,
    p_period_number: input.period ?? null,
    p_limit: 20,
  })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  if (error) {
    if (import.meta.env.DEV) console.error('Class search failed.', { error, input })
    throw new Error(safeClassSearchError(error))
  }
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.class_id as string,
    class_name: row.class_name as string,
    teacher_name: row.teacher_name as string,
    default_academic_term: row.default_academic_term as AcademicTerm,
    is_double_period: Boolean(row.is_double_period),
    meeting_slots: slotsFrom(row.meeting_slots),
    score: Number(row.score),
  }))
}

export async function enrollInClass(classId: string, term: AcademicTerm, allowConflict = false): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('enroll_in_class', {
    p_class_id: classId,
    p_academic_term: term,
    p_allow_conflict: allowConflict,
  })
  if (error) throw error
  return data as string
}

export async function createClassAndEnroll(input: {
  className: string
  teacherName: string
  term: AcademicTerm
  isDouble: boolean
  meetingSlots: MeetingSlot[]
  confirmedNoMatch: boolean
}): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('create_class_and_enroll', {
    p_class_name: input.className,
    p_teacher_name: input.teacherName,
    p_academic_term: input.term,
    p_is_double_period: input.isDouble,
    p_meeting_slots: input.meetingSlots,
    p_confirmed_no_match: input.confirmedNoMatch,
  })
  if (error) throw error
  return data as string
}

export async function removeEnrollment(enrollmentId: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('remove_enrollment', { p_enrollment_id: enrollmentId })
  if (error) throw error
}

export async function replaceEnrollment(enrollmentId: string, nextClassId: string, term: AcademicTerm, allowConflict = false): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('replace_enrollment', {
    p_enrollment_id: enrollmentId,
    p_new_class_id: nextClassId,
    p_academic_term: term,
    p_allow_conflict: allowConflict,
  })
  if (error) throw error
  return data as string
}

export async function updateEnrollmentTerm(enrollmentId: string, term: AcademicTerm): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('update_enrollment_term', { p_enrollment_id: enrollmentId, p_academic_term: term })
  if (error) throw error
}

export async function searchStudentDirectory(filters: { query?: string; grade?: number; className?: string; teacher?: string }): Promise<StudentDirectoryResult[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('search_student_directory', {
    p_query: filters.query || null,
    p_grade: filters.grade || null,
    p_class_name: filters.className || null,
    p_teacher_name: filters.teacher || null,
  })
  if (error) throw error
  return data as unknown as StudentDirectoryResult[]
}

export async function getVisibleSchedule(studentId: string): Promise<ScheduleEnrollment[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_visible_schedule', { p_student_id: studentId })
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.enrollment_id as string,
    student_id: studentId,
    class_id: row.class_id as string,
    academic_term: row.academic_term as AcademicTerm,
    active: true,
    created_at: row.created_at as string,
    updated_at: row.created_at as string,
    class: {
      id: row.class_id as string,
      class_name: row.class_name as string,
      teacher_name: row.teacher_name as string,
      default_academic_term: row.academic_term as AcademicTerm,
      is_double_period: Boolean(row.is_double_period),
      meeting_slots: slotsFrom(row.meeting_slots),
    },
  }))
}

export async function getClassMembers(classId: string): Promise<ClassMemberResult[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_class_members', { p_class_id: classId })
  if (error) throw error
  return data as unknown as ClassMemberResult[]
}

export async function getClassmates(): Promise<ClassmateResult[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_classmates')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    student_id: row.student_id as string,
    full_name: row.full_name as string,
    grade: row.grade as ClassmateResult['grade'],
    privacy_setting: row.privacy_setting as ClassmateResult['privacy_setting'],
    can_view_schedule: Boolean(row.can_view_schedule),
    shared_class_names: Array.isArray(row.shared_class_names) ? row.shared_class_names.map(String) : [],
  }))
}

export async function submitReport(input: {
  reason: string
  explanation?: string
  reportedUserId?: string
  reportedClassId?: string
}): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('create_report', {
    p_reason_category: input.reason,
    p_explanation: input.explanation || null,
    p_reported_user_id: input.reportedUserId || null,
    p_reported_class_id: input.reportedClassId || null,
  })
  if (error) throw error
  return data as string
}

export async function adminListUsers(query = '', grade?: number, status?: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_users', { p_query: query, p_grade: grade ?? null, p_status: status ?? null })
  if (error) throw error
  return data as unknown as Array<Record<string, unknown>>
}

export async function callAdminAction(functionName: string, args: Record<string, unknown>): Promise<unknown> {
  const client = requireClient()
  const { data, error } = await client.rpc(functionName, args)
  if (error) throw error
  return data
}

export function classFromSearch(result: ClassSearchResult): ClassDefinition {
  return {
    id: result.id,
    class_name: result.class_name,
    teacher_name: result.teacher_name,
    default_academic_term: result.default_academic_term,
    is_double_period: result.is_double_period,
    meeting_slots: result.meeting_slots,
  }
}
