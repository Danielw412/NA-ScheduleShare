import type { Profile, ScheduleEnrollment } from './domain'

const now = new Date().toISOString()

export const demoProfile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  full_name: 'Jordan Smith',
  grade: 11,
  privacy_setting: 'classmates',
  onboarding_completed: true,
  students_visited_at: null,
  created_at: now,
  updated_at: now,
}

export const demoEnrollments: ScheduleEnrollment[] = [
  ['1', 'AP Language', 'Carter', [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }], false],
  ['2', 'Academic Chemistry', 'Patel', [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }], false],
  ['3', 'Honors Algebra 2', 'Rivera', [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }], false],
  ['4', 'AP US History', 'Johnson', [
    { day_type: 'A', period_number: 4 }, { day_type: 'A', period_number: 5 },
    { day_type: 'B', period_number: 4 }, { day_type: 'B', period_number: 5 },
  ], true],
  ['5', 'Honors Spanish 3', 'Lopez', [{ day_type: 'A', period_number: 6 }, { day_type: 'B', period_number: 6 }], false],
  ['6', 'Academic Physics', 'Kim', [{ day_type: 'A', period_number: 7 }], false],
].map(([id, courseName, teacherLastName, slots, isDouble]) => ({
  id: `10000000-0000-4000-8000-00000000000${id}`,
  class_id: `20000000-0000-4000-8000-00000000000${id}`,
  student_id: demoProfile.id,
  academic_term: 'full_year',
  active: true,
  created_at: now,
  updated_at: now,
  meeting_slots: slots as Array<{ day_type: 'A' | 'B'; period_number: number }>,
  class: {
    id: `20000000-0000-4000-8000-00000000000${id}`,
    course_name_id: `30000000-0000-4000-8000-00000000000${id}`,
    course_name: courseName as string,
    teacher_last_name: teacherLastName as string,
    default_academic_term: 'full_year',
    is_double_period: isDouble as boolean,
    meeting_slots: slots as Array<{ day_type: 'A' | 'B'; period_number: number }>,
  },
}))
