import { describe, expect, it } from 'vitest'
import { createSchedulePolicyPredictionFunction, scheduleEngineCoverageIssues } from '../src/schedule-policy.js'
import type { CourseTermPolicy, CurrentScheduleEnrollment, ExistingSectionPlacement, MeetingSlot, ReplacementCourse, ScheduleEngineInput } from '../src/types.js'

function everyDay(period: number): MeetingSlot[] {
  return [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]
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
    active_enrollment_count: 10,
    pattern_source: 'section_default',
    ...overrides,
  }
}

function normalReplacement(courseId: string, courseName: string, courseTermPolicy: CourseTermPolicy = 'full_year'): Omit<ReplacementCourse, 'position'> {
  return { course_id: courseId, course_name: courseName, course_term_policy: courseTermPolicy }
}

function standardSchedule(): CurrentScheduleEnrollment[] {
  return Array.from({ length: 9 }, (_, index) => {
    const period = index + 1
    return enrollment(
      period === 1 ? 'english' : `filler-${period}`,
      period === 1 ? 'course-english' : `course-filler-${period}`,
      period === 1 ? 'English' : `Filler ${period}`,
      everyDay(period),
    )
  })
}

function request(
  currentSchedule: CurrentScheduleEnrollment[],
  sourceIds: string[],
  replacementCourses: Array<Omit<ReplacementCourse, 'position'>>,
  availableSections: ExistingSectionPlacement[],
): ScheduleEngineInput {
  return {
    job: {
      id: 'job-policy',
      user_id: 'user-policy',
      email_notification: false,
      attempt_count: 1,
      queued_at: '2026-08-07T07:00:00Z',
      claimed_at: '2026-08-07T07:01:00Z',
    },
    user: { id: 'user-policy', email: null },
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

const predict = createSchedulePolicyPredictionFunction()

describe('Schedule Engine completeness and credit policy', () => {
  it('accepts a fully filled 1.0-credit course swap', async () => {
    const current = standardSchedule()
    const input = request(current, ['english'], [normalReplacement('course-literature', 'Literature')], [
      section('literature-p1', 'course-literature', 'Literature', everyDay(1)),
    ])

    const outcome = await predict(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results).not.toHaveLength(0)
    expect(scheduleEngineCoverageIssues(outcome.results[0].schedule)).toEqual([])
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({
      course_id: 'course-literature',
      changed_from_enrollment_id: 'english',
    }))
  })

  it('rejects an incomplete current schedule before searching sections', async () => {
    const current = standardSchedule().filter((item) => item.enrollment_id !== 'filler-9')
    const outcome = await predict(request(current, ['english'], [normalReplacement('course-literature', 'Literature')], [
      section('literature-p1', 'course-literature', 'Literature', everyDay(1)),
    ]))

    expect(outcome.results).toEqual([])
    expect(outcome.no_valid_schedule_reason).toContain('must be fully filled')
    expect(outcome.no_valid_schedule_reason).toContain('A/B period 1–9')
  })

  it('rejects a 1.0-credit removal when the generated replacement is only 0.5 credits', async () => {
    const current = standardSchedule()
    const input = request(current, ['english'], [normalReplacement('course-art', 'Semester Art', 'semester')], [
      section('art-s1-p1', 'course-art', 'Semester Art', everyDay(1), {
        course_term_policy: 'semester',
        default_academic_term: 'semester_1',
        academic_term: 'semester_1',
      }),
    ])

    const outcome = await predict(input)
    expect(outcome.results).toEqual([])
    expect(outcome.no_valid_schedule_reason).toContain('replacement side must equal the 1.0 credits being removed')
  })

  it('automatically expands one Study Hall selection into two half-credit Study Halls when 1.0 credit is required', async () => {
    const current = standardSchedule()
    const studyHallSections = [
      section('study-a1', 'course-study', 'Study Hall - NASH', [{ day_type: 'A', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
      section('study-b1', 'course-study', 'Study Hall - NASH', [{ day_type: 'B', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
    ]
    const input = request(current, ['english'], [normalReplacement('course-study', 'Study Hall - NASH', 'flexible_attendance')], studyHallSections)

    const outcome = await predict(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    const studyHalls = outcome.results[0].schedule.filter((item) => item.course_id === 'course-study')
    expect(studyHalls).toHaveLength(2)
    expect(studyHalls.flatMap((item) => item.meeting_slots).map((slot) => `${slot.day_type}${slot.period_number}`).sort()).toEqual(['A1', 'B1'])
    expect(outcome.results[0].explanations.join(' ')).toContain('expanded to two half-credit Study Halls')
    expect(scheduleEngineCoverageIssues(outcome.results[0].schedule)).toEqual([])
  })

  it('accepts two explicit selections of the same Study Hall course', async () => {
    const current = standardSchedule()
    const studyHall = normalReplacement('course-study', 'Study Hall - NASH', 'flexible_attendance')
    const input = request(current, ['english'], [studyHall, studyHall], [
      section('study-a1', 'course-study', 'Study Hall - NASH', [{ day_type: 'A', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
      section('study-b1', 'course-study', 'Study Hall - NASH', [{ day_type: 'B', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
    ])

    const outcome = await predict(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results[0].schedule.filter((item) => item.course_id === 'course-study')).toHaveLength(2)
    expect(scheduleEngineCoverageIssues(outcome.results[0].schedule)).toEqual([])
  })

  it('balances a 1.5-credit double-period course against 1.0 plus 0.5 credits', async () => {
    const doubleSlots: MeetingSlot[] = [
      { day_type: 'A', period_number: 1 },
      { day_type: 'A', period_number: 2 },
      { day_type: 'B', period_number: 1 },
    ]
    const current = [
      enrollment('double-science', 'course-double-science', 'Double Science', doubleSlots, { is_double_period: true }),
      enrollment('b2-study', 'course-b2-study', 'Study Hall - Current', [{ day_type: 'B', period_number: 2 }], { course_term_policy: 'flexible_attendance' }),
      ...Array.from({ length: 7 }, (_, index) => {
        const period = index + 3
        return enrollment(`filler-${period}`, `course-filler-${period}`, `Filler ${period}`, everyDay(period))
      }),
    ]
    const input = request(current, ['double-science'], [
      normalReplacement('course-literature', 'Literature'),
      normalReplacement('course-study', 'Study Hall - NASH', 'flexible_attendance'),
    ], [
      section('literature-p1', 'course-literature', 'Literature', everyDay(1)),
      section('study-a2', 'course-study', 'Study Hall - NASH', [{ day_type: 'A', period_number: 2 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
    ])

    const outcome = await predict(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    const replacements = outcome.results[0].schedule.filter((item) => item.changed_from_enrollment_id === 'double-science')
    expect(replacements).toHaveLength(2)
    expect(replacements.map((item) => item.course_name).sort()).toEqual(['Literature', 'Study Hall - NASH'])
    expect(scheduleEngineCoverageIssues(outcome.results[0].schedule)).toEqual([])
  })

  it('supports multiple Study Halls already present in the current schedule', async () => {
    const current = [
      enrollment('study-a1', 'course-study', 'Study Hall - NASH', [{ day_type: 'A', period_number: 1 }], { course_term_policy: 'flexible_attendance' }),
      enrollment('study-b1', 'course-study', 'Study Hall - NASH', [{ day_type: 'B', period_number: 1 }], { course_term_policy: 'flexible_attendance' }),
      ...Array.from({ length: 8 }, (_, index) => {
        const period = index + 2
        return enrollment(period === 2 ? 'math' : `filler-${period}`, period === 2 ? 'course-math' : `course-filler-${period}`, period === 2 ? 'Math' : `Filler ${period}`, everyDay(period))
      }),
    ]
    const input = request(current, ['math'], [normalReplacement('course-history', 'History')], [
      section('history-p2', 'course-history', 'History', everyDay(2)),
      section('study-a1-alt', 'course-study', 'Study Hall - NASH', [{ day_type: 'A', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
      section('study-b1-alt', 'course-study', 'Study Hall - NASH', [{ day_type: 'B', period_number: 1 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
    ])

    const outcome = await predict(input)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results[0].schedule.filter((item) => item.course_id === 'course-study')).toHaveLength(2)
    expect(scheduleEngineCoverageIssues(outcome.results[0].schedule)).toEqual([])
  })
})
