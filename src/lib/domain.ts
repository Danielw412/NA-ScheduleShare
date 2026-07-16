export type DayType = 'A' | 'B'
export type AcademicTerm = 'full_year' | 'semester_1' | 'semester_2'
export type PrivacySetting = 'private' | 'classmates' | 'school'
export type Grade = 9 | 10 | 11 | 12

export interface MeetingSlot {
  day_type: DayType
  period_number: number
}

export interface ClassDefinition {
  id: string
  course_name_id: string
  course_name: string
  teacher_last_name: string
  default_academic_term: AcademicTerm
  /** Legacy compatibility metadata; meeting_slots is the schedule source of truth. */
  is_double_period: boolean
  meeting_slots: MeetingSlot[]
}

export interface ScheduleEnrollment {
  id: string
  class_id: string
  student_id: string
  academic_term: AcademicTerm
  active: boolean
  created_at: string
  updated_at: string
  class: ClassDefinition
}

export interface Profile {
  id: string
  full_name: string
  grade: Grade | null
  privacy_setting: PrivacySetting
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export interface AccountState {
  suspended: boolean
  suspension_reason: string | null
  deleted: boolean
}

export interface HistoryRecord {
  id: string
  action: 'class_added' | 'class_removed' | 'class_replaced' | 'term_changed' | 'meeting_slots_changed' | 'admin_schedule_change'
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  changed_by: string | null
  created_at: string
}

export interface ClassSearchResult extends ClassDefinition {
  score: number
}

export interface CourseNameSearchResult {
  id: string
  course_name: string
  score: number
}

export interface StudentDirectoryResult {
  student_id: string
  full_name: string
  grade: Grade
  privacy_setting: PrivacySetting
  shared_class_count: number
  can_view_schedule: boolean
}

export interface ReportableUser {
  student_id: string
  full_name: string
  grade: Grade
}

export interface AdminReportRecord {
  report_id: string
  reason_category: 'suspicious_user' | 'inappropriate_name' | 'incorrect_class_information' | 'duplicate_class' | 'other'
  explanation: string | null
  status: 'open' | 'in_review' | 'resolved' | 'dismissed'
  reporter_id: string | null
  reporter_name: string | null
  reported_user_id: string | null
  reported_user_name: string | null
  reported_class_id: string | null
  reported_course_name: string | null
  assigned_admin_id: string | null
  assigned_admin_name: string | null
  resolution_notes: string | null
  created_at: string
  resolved_at: string | null
}

export interface AdminClassRecord extends ClassDefinition {
  status: 'active' | 'archived' | 'merged'
  active_enrollment_count: number
  total_enrollment_count: number
  report_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AdminCourseNameRecord {
  id: string
  course_name: string
  status: 'active' | 'disabled' | 'merged'
  source: 'approved' | 'legacy' | 'user' | 'admin'
  section_count: number
  active_section_count: number
  created_at: string
  updated_at: string
}

export interface ClassMemberResult {
  student_id: string
  full_name: string
  grade: Grade
  privacy_setting: PrivacySetting
  can_view_schedule: boolean
}

export interface ClassmateResult extends ClassMemberResult {
  shared_course_names: string[]
}

export const termLabels: Record<AcademicTerm, string> = {
  full_year: 'Full Year',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
}

export const privacyLabels: Record<PrivacySetting, string> = {
  private: 'Private',
  classmates: 'Classmates',
  school: 'School',
}
