import type { ScheduleEngineInput } from '../src/types.js'

export const workerInput: ScheduleEngineInput = {
  job: { id: 'job-1', user_id: 'user-1', email_notification: true, attempt_count: 1, queued_at: '2026-08-01T12:00:00Z', claimed_at: '2026-08-01T12:01:00Z' },
  user: { id: 'user-1', email: 'student@example.com' },
  current_schedule: [{
    enrollment_id: 'enrollment-1',
    class_id: 'class-1',
    course_id: 'course-1',
    course_name: 'English',
    course_term_policy: 'full_year',
    teacher_last_name: 'Carter',
    academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  }],
  source_courses: [{
    position: 1,
    enrollment_id: 'enrollment-1',
    current_course: {
      enrollment_id: 'enrollment-1',
      class_id: 'class-1',
      course_id: 'course-1',
      course_name: 'English',
      course_term_policy: 'full_year',
      teacher_last_name: 'Carter',
      academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
    },
  }],
  replacement_courses: [{ course_id: 'course-2', course_name: 'Literature', course_term_policy: 'full_year' }],
  replacement_course_sections: [],
}
