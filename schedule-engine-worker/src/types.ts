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
  position: number
  course_id: string
  course_name: string
  course_term_policy: CourseTermPolicy
}

export interface RequestedSourceCourse {
  position: number
  enrollment_id: string
  current_course: CurrentScheduleEnrollment
}

/**
 * One placement that already exists in ScheduleShare. Fixed courses expose
 * the section's locked schedule. Flexible-attendance sections additionally
 * expose distinct attendance patterns already used by active enrollments.
 */
export interface ExistingSectionPlacement {
  course_id: string
  course_name: string
  course_term_policy: CourseTermPolicy
  class_id: string
  teacher_last_name: string
  default_academic_term: AcademicTerm
  academic_term: AcademicTerm
  is_double_period: boolean
  meeting_slots: MeetingSlot[]
  active_enrollment_count: number
  pattern_source: 'section_default' | 'existing_enrollment'
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
  source_courses: RequestedSourceCourse[]
  replacement_courses: ReplacementCourse[]
  available_sections: ExistingSectionPlacement[]
}

export interface PredictedScheduleEnrollment extends CurrentScheduleEnrollment {
  changed_from_enrollment_id: string | null
}

export interface PredictedScheduleResult {
  schedule: PredictedScheduleEnrollment[]
  collateral_change_count: number
  search_stage: 'direct_replacement' | 'one_collateral_change' | 'displacement_chain'
  explanations: string[]
}

export interface PredictionOutcome {
  results: PredictedScheduleResult[]
  no_valid_schedule_reason: string | null
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
  source_courses: Array<{ position: number; enrollment_id: string; course_id: string; course_name: string }>
  replacement_courses: Array<{ position: number; course_id: string; course_name: string }>
  results: Array<{ rank: number; development_placeholder: boolean; prediction?: unknown }>
  no_valid_schedule_reason?: string
}

export type PredictionFunction = (input: ScheduleEngineInput) => Promise<PredictionOutcome>

export interface ScheduleEngineStore {
  listJobs(limit?: number): Promise<WorkerJobSummary[]>
  claimNext(workerId: string): Promise<ClaimedScheduleEngineJob | null>
  getWorkerInput(jobId: string, workerId: string): Promise<ScheduleEngineInput>
  complete(jobId: string, workerId: string, outcome: PredictionOutcome): Promise<void>
  fail(jobId: string, workerId: string, errorMessage: string): Promise<void>
  recordNotification(jobId: string, workerId: string, delivery: Exclude<NotificationDelivery, { status: 'not_configured' }>): Promise<void>
}
