import { describe, expect, it } from 'vitest'
import { predictSchedules } from '../src/prediction-engine.js'
import { createSchedulePolicyPredictionFunction } from '../src/schedule-policy.js'
import type {
  CourseTermPolicy,
  CurrentScheduleEnrollment,
  ExistingSectionPlacement,
  MeetingSlot,
  ReplacementCourse,
  ScheduleEngineInput,
} from '../src/types.js'

function everyDay(period: number): MeetingSlot[] {
  return [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]
}

function enrollment(
  enrollmentId: string,
  classId: string,
  courseId: string,
  courseName: string,
  meetingSlots: MeetingSlot[],
  overrides: Partial<CurrentScheduleEnrollment> = {},
): CurrentScheduleEnrollment {
  return {
    enrollment_id: enrollmentId,
    class_id: classId,
    course_id: courseId,
    course_name: courseName,
    course_term_policy: 'full_year',
    teacher_last_name: `${courseName}Teacher`,
    academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: meetingSlots,
    ...overrides,
  }
}

function section(
  classId: string,
  courseId: string,
  courseName: string,
  meetingSlots: MeetingSlot[],
  overrides: Partial<ExistingSectionPlacement> = {},
): ExistingSectionPlacement {
  return {
    class_id: classId,
    course_id: courseId,
    course_name: courseName,
    course_term_policy: 'full_year',
    teacher_last_name: `${courseName}Teacher`,
    default_academic_term: 'full_year',
    academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: meetingSlots,
    active_enrollment_count: 10,
    pattern_source: 'section_default',
    ...overrides,
  }
}

function replacement(courseId: string, courseName: string, courseTermPolicy: CourseTermPolicy = 'full_year'): Omit<ReplacementCourse, 'position'> {
  return { course_id: courseId, course_name: courseName, course_term_policy: courseTermPolicy }
}

function request(
  currentSchedule: CurrentScheduleEnrollment[],
  sourceIds: string[],
  replacementCourses: Array<Omit<ReplacementCourse, 'position'>>,
  availableSections: ExistingSectionPlacement[],
): ScheduleEngineInput {
  return {
    job: {
      id: 'duplicate-class-regression',
      user_id: 'user-regression',
      email_notification: false,
      attempt_count: 1,
      queued_at: '2026-08-12T20:46:07Z',
      claimed_at: '2026-08-12T20:47:49Z',
    },
    user: { id: 'user-regression', email: null },
    current_schedule: currentSchedule,
    source_courses: sourceIds.map((enrollmentId, index) => ({
      position: index + 1,
      enrollment_id: enrollmentId,
      current_course: currentSchedule.find((item) => item.enrollment_id === enrollmentId)!,
    })),
    replacement_courses: replacementCourses.map((course, index) => ({ ...course, position: index + 1 })),
    available_sections: availableSections,
  }
}

describe('duplicate physical class section regression', () => {
  it('rejects two fixed entities that use the same physical class section even when course ids and A/B slots differ', () => {
    const dropped = enrollment('drop', 'drop-class', 'drop-course', 'Dropped', everyDay(1))
    const input = request([dropped], ['drop'], [
      replacement('study-alias-a', 'Study Hall A', 'flexible_attendance'),
      replacement('study-alias-b', 'Study Hall B', 'flexible_attendance'),
    ], [
      section('shared-physical-class', 'study-alias-a', 'Study Hall A', [{ day_type: 'A', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
      }),
      section('shared-physical-class', 'study-alias-b', 'Study Hall B', [{ day_type: 'B', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
      }),
    ])

    const outcome = predictSchedules(input)
    expect(outcome.results).toEqual([])
    expect(outcome.no_valid_schedule_reason).toContain('same class section more than once')
  })

  it('keeps searching when the first arrangement reuses a class id and returns a distinct-section alternative', () => {
    const dropped = enrollment('drop', 'drop-class', 'drop-course', 'Dropped', everyDay(1))
    const movable = enrollment(
      'movable',
      'shared-physical-class',
      'study-alias-current',
      'Study Hall Current',
      [{ day_type: 'A', period_number: 2 }],
      { course_term_policy: 'flexible_attendance' },
    )
    const input = request([dropped, movable], ['drop'], [
      replacement('study-alias-target', 'Study Hall Target', 'flexible_attendance'),
    ], [
      section('shared-physical-class', 'study-alias-target', 'Study Hall Target', [{ day_type: 'B', period_number: 2 }], {
        course_term_policy: 'flexible_attendance',
        active_enrollment_count: 50,
      }),
      section('distinct-current-class', 'study-alias-current', 'Study Hall Current', [{ day_type: 'A', period_number: 3 }], {
        course_term_policy: 'flexible_attendance',
      }),
    ])

    const outcome = predictSchedules(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results).not.toHaveLength(0)
    expect(outcome.results[0]).toMatchObject({ collateral_change_count: 1, search_stage: 'one_collateral_change' })
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      enrollment_id: expect.stringContaining('-move-'),
      class_id: 'distinct-current-class',
      changed_from_enrollment_id: 'movable',
    }))
    const classIds = outcome.results[0].schedule.map((item) => item.class_id)
    expect(new Set(classIds).size).toBe(classIds.length)
  })

  it('preserves the supported same-class Semester 1 plus Semester 2 Lunch pair', () => {
    const dropped = enrollment('drop', 'drop-class', 'drop-course', 'Dropped', everyDay(5))
    const input = request([dropped], ['drop'], [replacement('lunch-course', 'Lunch', 'lunch')], [
      section('shared-lunch-class', 'lunch-course', 'Lunch', everyDay(5), {
        course_term_policy: 'lunch',
        teacher_last_name: 'N/A',
        default_academic_term: 'semester_1',
        academic_term: 'semester_1',
      }),
      section('shared-lunch-class', 'lunch-course', 'Lunch', everyDay(5), {
        course_term_policy: 'lunch',
        teacher_last_name: 'N/A',
        default_academic_term: 'semester_2',
        academic_term: 'semester_2',
      }),
    ])

    const outcome = predictSchedules(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results[0].schedule).toHaveLength(2)
    expect(outcome.results[0].schedule.map((item) => item.academic_term)).toEqual(['semester_1', 'semester_2'])
    expect(outcome.results[0].schedule.every((item) => item.class_id === 'shared-lunch-class')).toBe(true)
  })

  it('still accepts the two semester courses to one full-year course shape from the failing job', async () => {
    const sociology = enrollment('sociology', 'sociology-class', 'sociology-course', 'Sociology', everyDay(1), {
      course_term_policy: 'semester',
      academic_term: 'semester_1',
    })
    const eastAsia = enrollment('east-asia', 'east-asia-class', 'east-asia-course', 'Honors History of East Asia', everyDay(1), {
      course_term_policy: 'semester',
      academic_term: 'semester_2',
    })
    const fillers = Array.from({ length: 8 }, (_, index) => {
      const period = index + 2
      return enrollment(`filler-${period}`, `filler-class-${period}`, `filler-course-${period}`, `Filler ${period}`, everyDay(period))
    })
    const current = [sociology, eastAsia, ...fillers]
    const input = request(current, ['sociology', 'east-asia'], [replacement('ap-econ-course', 'AP Economics')], [
      section('ap-econ-class', 'ap-econ-course', 'AP Economics', everyDay(1)),
    ])

    const outcome = await createSchedulePolicyPredictionFunction()(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results).not.toHaveLength(0)
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      class_id: 'ap-econ-class',
      course_name: 'AP Economics',
    }))
  })
})
