import { describe, expect, it } from 'vitest'
import { predictSchedules } from '../src/prediction-engine.js'
import type {
  CourseTermPolicy,
  CurrentScheduleEnrollment,
  ExistingSectionPlacement,
  MeetingSlot,
  ReplacementCourse,
  ScheduleEngineInput,
} from '../src/types.js'
import { workerInput } from './fixtures.js'

function everyDay(period: number): MeetingSlot[] {
  return [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]
}

function oneDay(dayType: 'A' | 'B', period: number): MeetingSlot[] {
  return [{ day_type: dayType, period_number: period }]
}

function enrollment(
  id: string,
  courseId: string,
  courseName: string,
  meetingSlots: MeetingSlot[],
  overrides: Partial<CurrentScheduleEnrollment> = {},
): CurrentScheduleEnrollment {
  return {
    enrollment_id: id,
    class_id: `class-${id}`,
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
    course_id: courseId,
    course_name: courseName,
    course_term_policy: 'full_year',
    class_id: classId,
    teacher_last_name: `${courseName}Teacher`,
    default_academic_term: 'full_year',
    academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: meetingSlots,
    active_enrollment_count: 0,
    pattern_source: 'section_default',
    ...overrides,
  }
}

function flexibleVariants(
  classId: string,
  courseId: string,
  courseName: string,
  period: number,
  teacherLastName = 'N/A',
): ExistingSectionPlacement[] {
  const common = {
    course_term_policy: 'flexible_attendance' as const,
    teacher_last_name: teacherLastName,
  }
  return [
    section(classId, courseId, courseName, oneDay('A', period), common),
    section(classId, courseId, courseName, oneDay('B', period), common),
    section(classId, courseId, courseName, everyDay(period), {
      ...common,
      default_academic_term: 'semester_1',
      academic_term: 'semester_1',
    }),
    section(classId, courseId, courseName, everyDay(period), {
      ...common,
      default_academic_term: 'semester_2',
      academic_term: 'semester_2',
    }),
  ]
}

function replacement(
  courseId: string,
  courseName: string,
  courseTermPolicy: CourseTermPolicy = 'full_year',
): Omit<ReplacementCourse, 'position'> {
  return { course_id: courseId, course_name: courseName, course_term_policy: courseTermPolicy }
}

function request(
  currentSchedule: CurrentScheduleEnrollment[],
  sourceIds: string[],
  replacementCourses: Array<Omit<ReplacementCourse, 'position'>>,
  availableSections: ExistingSectionPlacement[],
): ScheduleEngineInput {
  return {
    ...workerInput,
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

const physicsSlots: MeetingSlot[] = [
  { day_type: 'A', period_number: 2 },
  { day_type: 'A', period_number: 3 },
  { day_type: 'B', period_number: 2 },
]

describe('Schedule Engine flexible-attendance regressions', () => {
  it('replaces AP Physics A2/B2/A3 with AP Calculus AB P2 and full-year A3 Study Hall', () => {
    const physics = enrollment('physics', 'physics-course', 'AP Physics 1&2', physicsSlots, { is_double_period: true })
    const gym = enrollment('gym', 'gym-course', 'Gym', oneDay('B', 3), { course_term_policy: 'flexible_attendance' })
    const computerScience = enrollment('csa', 'csa-course', 'AP Computer Science A', everyDay(5))
    const history = enrollment('apush', 'apush-course', 'AP US History', everyDay(8))
    const lunchOne = enrollment('lunch-s1', 'lunch-course', 'Lunch - NASH', everyDay(7), {
      course_term_policy: 'lunch', academic_term: 'semester_1', teacher_last_name: 'N/A',
    })
    const lunchTwo = enrollment('lunch-s2', 'lunch-course', 'Lunch - NASH', everyDay(7), {
      course_term_policy: 'lunch', academic_term: 'semester_2', teacher_last_name: 'N/A',
    })

    const input = request(
      [physics, gym, computerScience, history, lunchOne, lunchTwo],
      ['physics'],
      [
        replacement('study-course', 'Study Hall - NASH', 'flexible_attendance'),
        replacement('calc-course', 'AP Calculus AB'),
      ],
      [
        section('calc-p2', 'calc-course', 'AP Calculus AB', everyDay(2), { teacher_last_name: 'Solenday' }),
        ...flexibleVariants('study-p3', 'study-course', 'Study Hall - NASH', 3),
        ...flexibleVariants('study-p5', 'study-course', 'Study Hall - NASH', 5),
        ...flexibleVariants('study-p7', 'study-course', 'Study Hall - NASH', 7),
        ...flexibleVariants('study-p8', 'study-course', 'Study Hall - NASH', 8),
      ],
    )

    const outcome = predictSchedules(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results[0]).toMatchObject({ collateral_change_count: 0, search_stage: 'direct_replacement' })
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      class_id: 'calc-p2', meeting_slots: everyDay(2), changed_from_enrollment_id: 'physics',
    }))
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      class_id: 'study-p3', academic_term: 'full_year', meeting_slots: oneDay('A', 3), changed_from_enrollment_id: 'physics',
    }))
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      enrollment_id: 'gym', meeting_slots: oneDay('B', 3), changed_from_enrollment_id: null,
    }))
  })

  it('treats A3 and B3 as separate full-year slots', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(1))
    const gym = enrollment('gym', 'gym-course', 'Gym', oneDay('B', 3), { course_term_policy: 'flexible_attendance' })
    const input = request(
      [dropped, gym],
      ['drop'],
      [replacement('study-course', 'Study Hall - NASH', 'flexible_attendance')],
      [section('study-a3', 'study-course', 'Study Hall - NASH', oneDay('A', 3), {
        course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A',
      })],
    )

    expect(predictSchedules(input).results[0]).toMatchObject({ collateral_change_count: 0 })
  })

  it('still rejects the same A/B-day period when terms overlap', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(1))
    const existing = enrollment('existing', 'existing-course', 'Existing A3', oneDay('A', 3))
    const input = request(
      [dropped, existing],
      ['drop'],
      [replacement('study-course', 'Study Hall - NASH', 'flexible_attendance')],
      [section('study-a3', 'study-course', 'Study Hall - NASH', oneDay('A', 3), {
        course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A',
      })],
    )

    expect(predictSchedules(input).results).toEqual([])
  })

  it('allows Semester 1 and Semester 2 courses to reuse the same A/B period', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(1), {
      course_term_policy: 'semester', academic_term: 'semester_1',
    })
    const semesterTwo = enrollment('semester-two', 's2-course', 'Semester Two', everyDay(3), {
      course_term_policy: 'semester', academic_term: 'semester_2',
    })
    const input = request(
      [dropped, semesterTwo],
      ['drop'],
      [replacement('study-course', 'Study Hall - NASH', 'flexible_attendance')],
      [section('study-s1-p3', 'study-course', 'Study Hall - NASH', everyDay(3), {
        course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A',
        default_academic_term: 'semester_1', academic_term: 'semester_1',
      })],
    )

    expect(predictSchedules(input).results[0]).toMatchObject({ collateral_change_count: 0 })
  })

  it('ranks A3 Study Hall above B3 Study Hall when B3 requires moving Gym', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(1))
    const gym = enrollment('gym', 'gym-course', 'Gym', oneDay('B', 3), { course_term_policy: 'flexible_attendance' })
    const input = request(
      [dropped, gym],
      ['drop'],
      [replacement('study-course', 'Study Hall - NASH', 'flexible_attendance')],
      [
        section('study-p3', 'study-course', 'Study Hall - NASH', oneDay('B', 3), {
          course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A', active_enrollment_count: 10,
        }),
        section('study-p3', 'study-course', 'Study Hall - NASH', oneDay('A', 3), {
          course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A', active_enrollment_count: 0,
        }),
        section('gym-a4', 'gym-course', 'Gym', oneDay('A', 4), {
          course_term_policy: 'flexible_attendance', teacher_last_name: 'Winters',
        }),
      ],
    )

    const outcome = predictSchedules(input)
    expect(outcome.results.map((result) => result.collateral_change_count)).toEqual([0, 1])
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({ class_id: 'study-p3', meeting_slots: oneDay('A', 3) }))
  })

  it('does not alter fixed full-year section patterns', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(2))
    const input = request(
      [dropped],
      ['drop'],
      [replacement('calc-course', 'AP Calculus AB')],
      [section('calc-p4', 'calc-course', 'AP Calculus AB', everyDay(4))],
    )

    const predicted = predictSchedules(input).results[0].schedule[0]
    expect(predicted).toMatchObject({ class_id: 'calc-p4', academic_term: 'full_year', meeting_slots: everyDay(4) })
  })

  it('keeps Lunch pairing behavior unchanged beside generated Study Hall choices', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(6))
    const lunchOne = section('lunch-s1', 'lunch-course', 'Lunch - NASH', everyDay(6), {
      course_term_policy: 'lunch', teacher_last_name: 'N/A',
      default_academic_term: 'semester_1', academic_term: 'semester_1',
    })
    const lunchTwo = section('lunch-s2', 'lunch-course', 'Lunch - NASH', everyDay(6), {
      course_term_policy: 'lunch', teacher_last_name: 'N/A',
      default_academic_term: 'semester_2', academic_term: 'semester_2',
    })
    const input = request(
      [dropped],
      ['drop'],
      [replacement('lunch-course', 'Lunch - NASH', 'lunch')],
      [lunchOne, lunchTwo, ...flexibleVariants('study-p3', 'study-course', 'Study Hall - NASH', 3)],
    )

    expect(predictSchedules(input).results[0].schedule.map((item) => item.academic_term)).toEqual(['semester_1', 'semester_2'])
  })

  it('returns unique results when generated and observed flexible patterns are identical', () => {
    const dropped = enrollment('drop', 'drop-course', 'Dropped', everyDay(1))
    const generated = section('study-p3', 'study-course', 'Study Hall - NASH', oneDay('A', 3), {
      course_term_policy: 'flexible_attendance', teacher_last_name: 'N/A', pattern_source: 'section_default',
    })
    const observed = { ...generated, pattern_source: 'existing_enrollment' as const, active_enrollment_count: 12 }
    const input = request(
      [dropped],
      ['drop'],
      [replacement('study-course', 'Study Hall - NASH', 'flexible_attendance')],
      [generated, observed],
    )

    expect(predictSchedules(input).results).toHaveLength(1)
  })
})
