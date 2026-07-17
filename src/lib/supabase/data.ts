import type {
  AcademicTerm,
  AdminClassRecord,
  AdminCourseNameRecord,
  AdminReportRecord,
  ClassDefinition,
  ClassmateResult,
  ClassMemberResult,
  ClassSearchResult,
  CourseNameSearchResult,
  DayType,
  GuestStudentResult,
  HistoryRecord,
  HomepageStatistic,
  HomepageStatisticSettings,
  MeetingSlot,
  ReportableUser,
  ScheduleEnrollment,
  ScheduleImportDiagnosticLog,
  ScheduleImportModelRecord,
  StudentDirectoryResult,
} from '../domain'
import { supabase } from './client'
import type { Json } from './database.types'

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
    .select('id, student_id, class_id, academic_term, active, created_at, updated_at, classes!inner(id, course_name_id, teacher_last_name, default_academic_term, is_double_period, course_names!inner(id, name), class_meeting_slots(day_type, period_number))')
    .eq('student_id', studentId)
    .eq('active', true)
    .order('created_at')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => {
    const classRow = row.classes as Record<string, unknown>
    const courseNameRow = classRow.course_names as Record<string, unknown>
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
        course_name_id: courseNameRow.id as string,
        course_name: courseNameRow.name as string,
        teacher_last_name: classRow.teacher_last_name as string,
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
    p_day_type: input.dayType,
    p_period_number: input.period,
    p_limit: 20,
  })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  if (error) {
    if (import.meta.env.DEV) console.error('Class search failed.', { error, input })
    throw new Error(safeClassSearchError(error))
  }
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.class_id as string,
    course_name_id: row.course_name_id as string,
    course_name: row.course_name as string,
    teacher_last_name: row.teacher_last_name as string,
    default_academic_term: row.default_academic_term as AcademicTerm,
    is_double_period: Boolean(row.is_double_period),
    meeting_slots: slotsFrom(row.meeting_slots),
    score: Number(row.score),
  }))
}

export async function searchCourseNames(query: string, signal?: AbortSignal): Promise<CourseNameSearchResult[]> {
  const client = requireClient()
  const request = client.rpc('search_course_names', { p_query: query, p_limit: 20 })
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  if (error) throw new Error(safeClassSearchError(error))
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.course_name_id as string,
    course_name: row.course_name as string,
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
  courseNameId?: string
  newCourseName?: string
  teacherLastName: string
  term: AcademicTerm
  isDoublePeriod: boolean
  meetingSlots: MeetingSlot[]
  confirmedNoCourseMatch: boolean
}): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('create_class_and_enroll', {
    p_course_name_id: (input.courseNameId ?? null) as unknown as string,
    p_new_course_name: (input.newCourseName ?? null) as unknown as string,
    p_teacher_last_name: input.teacherLastName,
    p_academic_term: input.term,
    p_is_double_period: input.isDoublePeriod,
    p_meeting_slots: input.meetingSlots as unknown as Json,
    p_confirmed_no_course_match: input.confirmedNoCourseMatch,
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

export async function searchStudentDirectory(filters: { query?: string; grade?: number; courseName?: string; teacherLastName?: string }): Promise<StudentDirectoryResult[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('search_student_directory', {
    p_query: filters.query || undefined,
    p_grade: filters.grade || undefined,
    p_course_name: filters.courseName || undefined,
    p_teacher_last_name: filters.teacherLastName || undefined,
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
      course_name_id: row.course_name_id as string,
      course_name: row.course_name as string,
      teacher_last_name: row.teacher_last_name as string,
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
    shared_course_names: Array.isArray(row.shared_course_names) ? row.shared_course_names.map(String) : [],
  }))
}

export async function submitReport(input: {
  reason: AdminReportRecord['reason_category']
  explanation?: string
  reportedUserId?: string
  reportedClassId?: string
}): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('create_report', {
    p_reason_category: input.reason,
    p_explanation: input.explanation || undefined,
    p_reported_user_id: input.reportedUserId || undefined,
    p_reported_class_id: input.reportedClassId || undefined,
  })
  if (error) throw error
  return data as string
}

export async function searchReportableUsers(query = '', userId?: string): Promise<ReportableUser[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('search_reportable_users', {
    p_query: query,
    p_user_id: userId,
    p_limit: 20,
  })
  if (error) throw error
  return data as unknown as ReportableUser[]
}

export async function adminListUsers(query = '', grade?: number, status?: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_users', { p_query: query, p_grade: grade, p_status: status })
  if (error) throw error
  return data as unknown as Array<Record<string, unknown>>
}

export async function adminListReports(): Promise<AdminReportRecord[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_reports')
  if (error) throw error
  return data as unknown as AdminReportRecord[]
}

export async function adminListClasses(): Promise<AdminClassRecord[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_classes')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.class_id as string,
    course_name_id: row.course_name_id as string,
    course_name: row.course_name as string,
    teacher_last_name: row.teacher_last_name as string,
    default_academic_term: row.default_academic_term as AcademicTerm,
    is_double_period: Boolean(row.is_double_period),
    meeting_slots: slotsFrom(row.meeting_slots),
    status: row.status as AdminClassRecord['status'],
    active_enrollment_count: Number(row.active_enrollment_count),
    total_enrollment_count: Number(row.total_enrollment_count),
    report_count: Number(row.report_count),
    created_by: row.created_by as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }))
}

export async function adminListCourseNames(): Promise<AdminCourseNameRecord[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_course_names')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.course_name_id as string,
    course_name: row.course_name as string,
    status: row.status as AdminCourseNameRecord['status'],
    source: row.source as AdminCourseNameRecord['source'],
    section_count: Number(row.section_count),
    active_section_count: Number(row.active_section_count),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }))
}

export async function adminUpdateClass(input: {
  classId: string
  courseNameId: string
  teacherLastName: string
  term: AcademicTerm
  isDoublePeriod: boolean
  meetingSlots: MeetingSlot[]
  reason: string
}): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('admin_update_class', {
    p_class_id: input.classId,
    p_course_name_id: input.courseNameId,
    p_teacher_last_name: input.teacherLastName,
    p_academic_term: input.term,
    p_is_double_period: input.isDoublePeriod,
    p_meeting_slots: input.meetingSlots as unknown as Json,
    p_reason: input.reason,
  })
  if (error) throw error
}

async function callUntypedRpc(functionName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const client = requireClient()
  const rpc = client.rpc.bind(client) as unknown as (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>
  const { data, error } = await rpc(functionName, args)
  if (error) throw error
  return data
}

export async function searchGuestStudents(firstName: string): Promise<GuestStudentResult[]> {
  const data = await callUntypedRpc('guest_search_students', {
    p_first_name: firstName,
    p_limit: 12,
  })
  return (data as Array<Record<string, unknown>>).map((row) => ({
    first_name: String(row.first_name),
    last_initial: String(row.last_initial),
    display_name: String(row.display_name),
  }))
}

export async function getHomepageStatistic(): Promise<HomepageStatistic | null> {
  const data = await callUntypedRpc('get_homepage_statistic')
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  if (!row) return null
  return {
    statistic_key: String(row.statistic_key) as HomepageStatistic['statistic_key'],
    activity_scope: String(row.activity_scope) as HomepageStatistic['activity_scope'],
    statistic_value: Number(row.statistic_value),
    statistic_label: String(row.statistic_label),
  }
}

export async function adminGetHomepageStatisticSettings(): Promise<HomepageStatisticSettings> {
  const data = await callUntypedRpc('admin_get_homepage_statistic_settings')
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  if (!row) throw new Error('Homepage statistic settings are missing.')
  return {
    shown: Boolean(row.shown),
    statistic_key: String(row.statistic_key) as HomepageStatisticSettings['statistic_key'],
    minimum_value: Number(row.minimum_value),
    activity_scope: String(row.activity_scope) as HomepageStatisticSettings['activity_scope'],
    updated_at: String(row.updated_at),
  }
}

export async function adminUpdateHomepageStatisticSettings(input: Omit<HomepageStatisticSettings, 'updated_at'>): Promise<void> {
  await callUntypedRpc('admin_update_homepage_statistic_settings', {
    p_shown: input.shown,
    p_statistic_key: input.statistic_key,
    p_minimum_value: input.minimum_value,
    p_activity_scope: input.activity_scope,
  })
}

export async function adminListScheduleImportModels(): Promise<ScheduleImportModelRecord[]> {
  const data = await callUntypedRpc('admin_list_schedule_import_models')
  return (data as Array<Record<string, unknown>>).map((row) => ({
    model_id: String(row.model_id),
    display_name: String(row.display_name),
    enabled: Boolean(row.enabled),
    supports_image_input: Boolean(row.supports_image_input),
    supports_structured_output: Boolean(row.supports_structured_output),
    supported_thinking_levels: Array.isArray(row.supported_thinking_levels)
      ? row.supported_thinking_levels.map(String) as ScheduleImportModelRecord['supported_thinking_levels']
      : [],
    max_output_tokens: Number(row.max_output_tokens),
    is_active: Boolean(row.is_active),
    production_thinking_level: String(row.production_thinking_level) as ScheduleImportModelRecord['production_thinking_level'],
    production_output_token_limit: Number(row.production_output_token_limit),
  }))
}

export async function adminUpdateScheduleImportSettings(input: {
  modelId: string
  thinkingLevel: ScheduleImportModelRecord['production_thinking_level']
  outputTokenLimit: number
}): Promise<void> {
  await callUntypedRpc('admin_update_schedule_import_settings', {
    p_model_id: input.modelId,
    p_thinking_level: input.thinkingLevel,
    p_output_token_limit: input.outputTokenLimit,
  })
}

export async function adminListScheduleImportDiagnostics(): Promise<ScheduleImportDiagnosticLog[]> {
  const data = await callUntypedRpc('admin_list_schedule_import_diagnostics')
  return (data as Array<Record<string, unknown>>).map((row) => ({
    diagnostic_id: String(row.diagnostic_id),
    status: String(row.status) as ScheduleImportDiagnosticLog['status'],
    model_id: String(row.model_id),
    thinking_level: String(row.thinking_level) as ScheduleImportDiagnosticLog['thinking_level'],
    output_token_limit: Number(row.output_token_limit),
    prompt: String(row.prompt),
    raw_output: row.raw_output === null ? null : String(row.raw_output),
    parsed_output: row.parsed_output,
    validation_errors: row.validation_errors,
    provider_error: row.provider_error,
    timing_ms: Number(row.timing_ms),
    image_metadata: row.image_metadata,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
  }))
}

export async function adminDeleteScheduleImportDiagnostic(diagnosticId: string): Promise<void> {
  await callUntypedRpc('admin_delete_schedule_import_diagnostic', { p_diagnostic_id: diagnosticId })
}

export async function callAdminAction(
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callUntypedRpc(functionName, args)
}

export function classFromSearch(result: ClassSearchResult): ClassDefinition {
  return {
    id: result.id,
    course_name_id: result.course_name_id,
    course_name: result.course_name,
    teacher_last_name: result.teacher_last_name,
    default_academic_term: result.default_academic_term,
    is_double_period: result.is_double_period,
    meeting_slots: result.meeting_slots,
  }
}
