import type {
  AcademicTerm,
  AdminClassRecord,
  AdminCourseNameRecord,
  AdminReportRecord,
  AdminUserRecord,
  ClassDefinition,
  ClassmateResult,
  ClassMemberResult,
  ClassSearchResult,
  CourseNameSearchResult,
  CourseTermPolicy,
  DayType,
  EventLogCategory,
  EventLogRecord,
  GuestStudentResult,
  HomepageStatistic,
  HomepageStatisticSettings,
  MeetingSlot,
  ReportableUser,
  ScheduleAccessNotification,
  ScheduleAccessNotifications,
  ScheduleEnrollment,
  ScheduleImportDiagnosticLog,
  ScheduleImportModelRecord,
  ScheduleImportUiSettings,
  ActivitySummary,
  SiteResetPreview,
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
  limit?: number
  academicTerm?: AcademicTerm
}

function safeClassSearchError(error: { code?: string; message?: string }) {
  if (error.code === 'PGRST301' || error.message?.toLowerCase().includes('jwt')) {
    return 'Your session could not be verified. Refresh the page and sign in again.'
  }
  return 'Class search is temporarily unavailable. Please try again.'
}

export async function fetchSchedule(studentId: string): Promise<ScheduleEnrollment[]> {
  return getVisibleSchedule(studentId)
}

export async function searchClasses(input: ClassSearchInput, signal?: AbortSignal): Promise<ClassSearchResult[]> {
  const client = requireClient()
  const request = client.rpc('search_classes', {
    p_query: input.query,
    p_day_type: input.dayType,
    p_period_number: input.period,
    p_limit: input.limit ?? 20,
    p_academic_term: input.academicTerm,
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
    course_term_policy: row.course_term_policy as CourseTermPolicy,
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
    course_term_policy: row.course_term_policy as CourseTermPolicy,
    score: Number(row.score),
  }))
}

export async function enrollInClass(classId: string, term: AcademicTerm, meetingSlots?: MeetingSlot[]): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('enroll_in_class', {
    p_class_id: classId,
    p_academic_term: term,
    p_allow_conflict: false,
    p_meeting_slots: meetingSlots as unknown as Json | undefined,
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

export async function createClassAndReplaceEnrollment(enrollmentId: string, input: {
  courseNameId?: string
  newCourseName?: string
  teacherLastName: string
  term: AcademicTerm
  isDoublePeriod: boolean
  meetingSlots: MeetingSlot[]
  confirmedNoCourseMatch: boolean
}): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('create_class_and_replace_enrollment', {
    p_enrollment_id: enrollmentId,
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

export async function clearSchedule(): Promise<number> {
  const client = requireClient()
  const { data, error } = await client.rpc('clear_my_schedule')
  if (error) throw error
  const removed = Number(data)
  if (!Number.isSafeInteger(removed) || removed < 0) throw new Error('The server returned an invalid cleared class count.')
  return removed
}

export async function replaceEnrollment(enrollmentId: string, nextClassId: string, term: AcademicTerm, meetingSlots?: MeetingSlot[]): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.rpc('replace_enrollment', {
    p_enrollment_id: enrollmentId,
    p_new_class_id: nextClassId,
    p_academic_term: term,
    p_allow_conflict: false,
    p_meeting_slots: meetingSlots as unknown as Json | undefined,
  })
  if (error) throw error
  return data as string
}

export async function searchStudentDirectory(filters: { query?: string; grade?: number; courseName?: string; teacherLastName?: string }): Promise<StudentDirectoryResult[]> {
  const data = await callUntypedRpc('search_student_access_directory', {
    p_query: filters.query || undefined,
    p_grade: filters.grade || undefined,
    p_course_name: filters.courseName || undefined,
    p_teacher_last_name: filters.teacherLastName || undefined,
  })
  return (data as Array<Record<string, unknown>>).map((row) => ({
    student_id: String(row.student_id),
    full_name: String(row.full_name),
    grade: Number(row.grade) as StudentDirectoryResult['grade'],
    privacy_setting: String(row.privacy_setting) as StudentDirectoryResult['privacy_setting'],
    shared_class_count: Number(row.shared_class_count),
    can_view_schedule: Boolean(row.can_view_schedule),
    they_can_view_yours: String(row.they_can_view_yours) as StudentDirectoryResult['they_can_view_yours'],
    you_can_view_theirs: String(row.you_can_view_theirs) as StudentDirectoryResult['you_can_view_theirs'],
    outgoing_request_pending: Boolean(row.outgoing_request_pending),
  }))
}

export const scheduleAccessChangedEvent = 'scheduleshare:schedule-access-changed'

export function announceScheduleAccessChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(scheduleAccessChangedEvent))
}

function scheduleAccessActionError(caught: unknown, fallback: string): Error {
  const message = caught && typeof caught === 'object' && 'message' in caught ? String(caught.message) : ''
  if (message.includes('schedule_access_already_available')) return new Error('You already have access to this schedule.')
  if (message.includes('schedule_access_request_not_pending')) return new Error('That access request is no longer pending.')
  if (message.includes('schedule_access_target_unavailable')) return new Error('That student is no longer available.')
  if (message.includes('invalid_schedule_access_target')) return new Error('Choose another student.')
  return new Error(fallback)
}

async function runScheduleAccessAction(functionName: string, args: Record<string, unknown>, fallback: string): Promise<unknown> {
  try {
    const result = await callUntypedRpc(functionName, args)
    announceScheduleAccessChanged()
    return result
  } catch (caught) {
    throw scheduleAccessActionError(caught, fallback)
  }
}

export async function allowScheduleAccess(viewerId: string): Promise<void> {
  await runScheduleAccessAction('allow_schedule_access', { p_viewer_id: viewerId }, 'Access could not be allowed. Please try again.')
}

export async function removeScheduleAccess(viewerId: string): Promise<void> {
  await runScheduleAccessAction('remove_schedule_access', { p_viewer_id: viewerId }, 'Access could not be removed. Please try again.')
}

export async function requestScheduleAccess(ownerId: string): Promise<void> {
  await runScheduleAccessAction('request_schedule_access', { p_owner_id: ownerId }, 'The access request could not be sent. Please try again.')
}

export async function cancelScheduleAccessRequest(ownerId: string): Promise<void> {
  await runScheduleAccessAction('cancel_schedule_access_request', { p_owner_id: ownerId }, 'The access request could not be canceled. Please try again.')
}

export async function respondScheduleAccessRequest(requestId: string, allow: boolean): Promise<void> {
  await runScheduleAccessAction('respond_schedule_access_request', { p_request_id: requestId, p_allow: allow }, `The request could not be ${allow ? 'approved' : 'declined'}. Please try again.`)
}

function parseScheduleAccessNotification(value: unknown): ScheduleAccessNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'incoming_request' && row.kind !== 'request_update') return null
  if (row.status !== 'pending' && row.status !== 'approved' && row.status !== 'declined') return null
  if (typeof row.request_id !== 'string' || typeof row.student_id !== 'string' || typeof row.full_name !== 'string') return null
  return {
    request_id: row.request_id,
    kind: row.kind,
    status: row.status,
    student_id: row.student_id,
    full_name: row.full_name,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    read: Boolean(row.read),
  }
}

export async function getScheduleAccessNotifications(): Promise<ScheduleAccessNotifications> {
  const data = await callUntypedRpc('get_schedule_access_notifications', { p_limit: 30 })
  const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return {
    count: Math.max(0, Number(row.count) || 0),
    notifications: Array.isArray(row.notifications)
      ? row.notifications.map(parseScheduleAccessNotification).filter((item): item is ScheduleAccessNotification => item !== null)
      : [],
  }
}

export async function markScheduleAccessNotificationsRead(): Promise<void> {
  try {
    await callUntypedRpc('mark_schedule_access_notifications_read')
  } catch {
    // Reading a notification remains useful even if its optional read receipt fails.
  }
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
    meeting_slots: slotsFrom(row.meeting_slots),
    class: {
      id: row.class_id as string,
      course_name_id: row.course_name_id as string,
      course_name: row.course_name as string,
      teacher_last_name: row.teacher_last_name as string,
      course_term_policy: row.course_term_policy as CourseTermPolicy,
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

export async function adminListUsers(query = '', grade?: number, status?: string): Promise<AdminUserRecord[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_users', { p_query: query, p_grade: grade, p_status: status })
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    user_id: String(row.user_id),
    full_name: String(row.full_name),
    grade: row.grade === null ? null : Number(row.grade) as AdminUserRecord['grade'],
    privacy_setting: String(row.privacy_setting) as AdminUserRecord['privacy_setting'],
    status: String(row.status) as AdminUserRecord['status'],
    is_admin: Boolean(row.is_admin),
    created_at: String(row.created_at),
    last_login_at: row.last_login_at ? String(row.last_login_at) : null,
    last_active_at: row.last_active_at ? String(row.last_active_at) : null,
  }))
}

export async function updateEnrollmentSchedule(enrollmentId: string, term: AcademicTerm, meetingSlots: MeetingSlot[]): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc('update_enrollment_schedule', {
    p_enrollment_id: enrollmentId,
    p_academic_term: term,
    p_meeting_slots: meetingSlots as unknown as Json,
  })
  if (error) throw error
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

export async function searchGuestClasses(input: ClassSearchInput): Promise<ClassSearchResult[]> {
  const data = await callUntypedRpc('guest_search_classes', {
    p_query: input.query,
    p_day_type: input.dayType,
    p_period_number: input.period,
    p_limit: input.limit ?? 20,
    p_academic_term: input.academicTerm,
  })
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.class_id as string,
    course_name_id: row.course_name_id as string,
    course_name: row.course_name as string,
    course_term_policy: row.course_term_policy as CourseTermPolicy,
    teacher_last_name: row.teacher_last_name as string,
    default_academic_term: row.default_academic_term as AcademicTerm,
    is_double_period: Boolean(row.is_double_period),
    meeting_slots: slotsFrom(row.meeting_slots),
    score: Number(row.score),
  }))
}

export async function searchGuestCourseNames(query: string): Promise<CourseNameSearchResult[]> {
  const data = await callUntypedRpc('guest_search_course_names', {
    p_query: query,
    p_limit: 20,
  })
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.course_name_id),
    course_name: String(row.course_name),
    course_term_policy: row.course_term_policy as CourseTermPolicy,
    score: Number(row.score),
  }))
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

export async function getScheduleImportUiSettings(): Promise<ScheduleImportUiSettings> {
  const data = await callUntypedRpc('get_schedule_import_ui_settings')
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  return { progress_bar_duration_ms: Number(row?.progress_bar_duration_ms ?? 6500) }
}

export async function adminUpdateScheduleImportProgressDuration(progressBarDurationMs: number): Promise<void> {
  await callUntypedRpc('admin_update_schedule_import_progress_duration', {
    p_progress_bar_duration_ms: progressBarDurationMs,
  })
}

export async function callAdminAction(
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callUntypedRpc(functionName, args)
}

export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  return Boolean(await callUntypedRpc('is_current_user_super_admin'))
}

export interface EventLogFilters {
  category?: EventLogCategory | ''
  event?: string
  user?: string
  target?: string
  createdFrom?: string
  createdTo?: string
  result?: string
  limit?: number
  offset?: number
}

export async function superAdminListLogs(filters: EventLogFilters = {}): Promise<EventLogRecord[]> {
  const data = await callUntypedRpc('super_admin_list_logs', {
    p_category: filters.category || undefined,
    p_event: filters.event || undefined,
    p_user: filters.user || undefined,
    p_target: filters.target || undefined,
    p_created_from: filters.createdFrom || undefined,
    p_created_to: filters.createdTo || undefined,
    p_result: filters.result || undefined,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  })
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    log_category: String(row.log_category) as EventLogCategory,
    event_type: String(row.event_type),
    actor_user_id: row.actor_user_id ? String(row.actor_user_id) : null,
    actor_name: row.actor_name ? String(row.actor_name) : null,
    subject_user_id: row.subject_user_id ? String(row.subject_user_id) : null,
    subject_name: row.subject_name ? String(row.subject_name) : null,
    target_type: row.target_type ? String(row.target_type) : null,
    target_id: row.target_id ? String(row.target_id) : null,
    result: row.result ? String(row.result) : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    created_at: String(row.created_at),
  }))
}

export async function superAdminGetActivitySummary(): Promise<ActivitySummary> {
  const data = await callUntypedRpc('super_admin_get_activity_summary')
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  if (!row) throw new Error('Activity summary is unavailable.')
  return {
    total_users: Number(row.total_users),
    daily_active_users: Number(row.daily_active_users),
    weekly_active_users: Number(row.weekly_active_users),
    schedule_imports: Number(row.schedule_imports),
    schedules_shared: Number(row.schedules_shared),
    access_requests: Number(row.access_requests),
  }
}

export async function superAdminDeleteLog(logId: string): Promise<void> {
  const confirmation = `DELETE LOG ${logId.replaceAll('-', '').slice(0, 8).toUpperCase()}`
  await callUntypedRpc('super_admin_delete_log', { p_log_id: logId, p_confirmation: confirmation })
}

export async function superAdminDeleteLogs(filters: EventLogFilters = {}): Promise<number> {
  const data = await callUntypedRpc('super_admin_delete_logs', {
    p_category: filters.category || undefined,
    p_event: filters.event || undefined,
    p_user: filters.user || undefined,
    p_target: filters.target || undefined,
    p_created_from: filters.createdFrom || undefined,
    p_created_to: filters.createdTo || undefined,
    p_result: filters.result || undefined,
    p_confirmation: 'DELETE FILTERED LOGS PERMANENTLY',
  })
  return Number(data)
}

export async function superAdminAdd(email: string): Promise<string> {
  return String(await callUntypedRpc('super_admin_add', { p_email: email }))
}

export async function superAdminGetSiteResetPreview(): Promise<SiteResetPreview> {
  const data = await callUntypedRpc('super_admin_get_site_reset_preview')
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  if (!row) throw new Error('Reset preview is unavailable.')
  return {
    accounts: Number(row.accounts),
    profiles: Number(row.profiles),
    classes: Number(row.classes),
    course_names: Number(row.course_names),
    enrollments: Number(row.enrollments),
    reports: Number(row.reports),
    profile_pictures: Number(row.profile_pictures),
  }
}

export async function superAdminResetSite(confirmation: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.functions.invoke('site-reset', { body: { confirmation } })
  if (error) {
    const context = (error as unknown as { context?: unknown }).context
    const response = context instanceof Response ? context : null
    const body = response ? await response.clone().json().catch(() => ({})) as { message?: string } : {}
    throw new Error(body.message || 'The website reset did not complete. No database changes were made.')
  }
  await client.auth.signOut({ scope: 'local' })
}

export async function markUserActive(): Promise<void> {
  await callUntypedRpc('mark_user_active')
}

export async function recordShareButtonPressed(): Promise<void> {
  await callUntypedRpc('record_share_button_pressed')
}

export async function recordAuthAttempt(
  eventType: 'login_failed' | 'login_blocked_rate_limit' | 'password_reset_requested' | 'password_reset_failed',
  email: string,
  result?: string,
  errorCategory?: string,
): Promise<void> {
  await callUntypedRpc('record_auth_attempt', {
    p_event_type: eventType,
    p_email: email,
    p_result: result,
    p_error_category: errorCategory,
  })
}

export async function recordAuthenticatedEvent(
  eventType: string,
  result?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await callUntypedRpc('record_authenticated_event', {
    p_event_type: eventType,
    p_result: result,
    p_metadata: metadata as Json,
  })
}

export async function recordScheduleImportEvent(
  eventType: string,
  importId: string,
  result?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await callUntypedRpc('record_schedule_import_event', {
    p_event_type: eventType,
    p_import_id: importId,
    p_result: result,
    p_metadata: metadata as Json,
  })
}

export function classFromSearch(result: ClassSearchResult): ClassDefinition {
  return {
    id: result.id,
    course_name_id: result.course_name_id,
    course_name: result.course_name,
    teacher_last_name: result.teacher_last_name,
    default_academic_term: result.default_academic_term,
    course_term_policy: result.course_term_policy,
    is_double_period: result.is_double_period,
    meeting_slots: result.meeting_slots,
  }
}
