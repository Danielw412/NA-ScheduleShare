export type AcademicTerm = 'full_year' | 'semester_1' | 'semester_2'
export type DayType = 'A' | 'B'
export type CourseTermPolicy = 'full_year' | 'semester' | 'flexible_attendance' | 'sectioned_attendance' | 'lunch' | 'variable_credit' | 'versioned'

export interface MeetingSlot {
  day_type: DayType
  period_number: number
}

export interface ClaimedScheduleEngineJob {
  jobId: string
  userId: string
  emailNotification: boolean
  attemptCount: number
  claimedAt: string
}

export interface CurrentScheduleEnrollment {
  enrollment_id: string
  class_id: string
  course_id: string
  course_name: string
  course_term_policy: CourseTermPolicy
  teacher_last_name: string
  academic_term: AcademicTerm
  is_double_period: boolean
  meeting_slots: MeetingSlot[]
}

export interface ReplacementCourse {
  course_id: string
  course_name: string
  course_term_policy: CourseTermPolicy
}

export interface RequestedReplacement {
  position: number
  enrollment_id: string
  current_course: CurrentScheduleEnrollment
  replacement_course: ReplacementCourse
}

export interface ReplacementCourseSection {
  course_id: string
  course_name: string
  course_term_policy: CourseTermPolicy
  class_id: string
  teacher_last_name: string
  default_academic_term: AcademicTerm
  is_double_period: boolean
  meeting_slots: MeetingSlot[]
  active_enrollment_count: number
}

export interface ScheduleEngineInput {
  job: {
    id: string
    user_id: string
    email_notification: boolean
    attempt_count: number
    queued_at: string
    claimed_at: string
  }
  user: {
    id: string
    email: string | null
  }
  current_schedule: CurrentScheduleEnrollment[]
  replacements: RequestedReplacement[]
  replacement_course_sections: ReplacementCourseSection[]
}

export interface PredictedScheduleEnrollment extends CurrentScheduleEnrollment {
  changed_from_enrollment_id: string | null
}

export interface PredictedScheduleResult {
  schedule: PredictedScheduleEnrollment[]
  development_placeholder?: boolean
}

export interface NotificationDelivery {
  status: 'sent' | 'failed' | 'not_configured'
  errorMessage?: string
}

export type WorkerJobStatus = 'queued' | 'processing' | 'cancelled' | 'completed' | 'failed'

export interface WorkerJobSummary {
  id: string
  user_id: string
  user_name: string
  status: WorkerJobStatus
  email_notification: boolean
  notification_status: string
  notification_error?: string
  worker_id?: string
  attempt_count: number
  queued_at: string
  claimed_at?: string
  processing_started_at?: string
  heartbeat_at?: string
  completed_at?: string
  failed_at?: string
  cancelled_at?: string
  error_message?: string
  created_at: string
  replacements: Array<{ position: number; current_course_name: string; replacement_course_name: string }>
  results: Array<{ rank: number; development_placeholder: boolean }>
}

export type PredictionFunction = (input: ScheduleEngineInput) => Promise<PredictedScheduleResult[]>

export interface ScheduleEngineStore {
  listJobs(limit?: number): Promise<WorkerJobSummary[]>
  claimNext(workerId: string): Promise<ClaimedScheduleEngineJob | null>
  getWorkerInput(jobId: string, workerId: string): Promise<ScheduleEngineInput>
  complete(jobId: string, workerId: string, results: PredictedScheduleResult[]): Promise<void>
  fail(jobId: string, workerId: string, errorMessage: string): Promise<void>
  recordNotification(jobId: string, workerId: string, delivery: Exclude<NotificationDelivery, { status: 'not_configured' }>): Promise<void>
}
