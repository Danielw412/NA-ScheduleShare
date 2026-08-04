import { describe, expect, it } from 'vitest'
import { createPredictionFunction, maxCollateralChangesFromEnvironment, predictSchedules } from '../src/prediction-engine.js'
import type { CourseTermPolicy, CurrentScheduleEnrollment, ExistingSectionPlacement, MeetingSlot, ReplacementCourse, ScheduleEngineInput } from '../src/types.js'
import { workerInput } from './fixtures.js'

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
    active_enrollment_count: 5,
    pattern_source: 'section_default',
    ...overrides,
  }
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

function replacement(courseId: string, courseName: string, courseTermPolicy: CourseTermPolicy = 'full_year'): Omit<ReplacementCourse, 'position'> {
  return { course_id: courseId, course_name: courseName, course_term_policy: courseTermPolicy }
}

describe('Schedule Engine prediction search', () => {
  it('performs a direct replacement with an existing section and no collateral changes', async () => {
    const outcome = await createPredictionFunction()(workerInput)
    expect(outcome.no_valid_schedule_reason).toBeNull()
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]).toMatchObject({ collateral_change_count: 0, search_stage: 'direct_replacement' })
    expect(outcome.results[0].schedule).toEqual([expect.objectContaining({
      class_id: 'class-2',
      course_id: 'course-2',
      changed_from_enrollment_id: 'enrollment-1',
    })])
  })

  it('ranks a direct fit ahead of a more popular section that needs a collateral move', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1))
    const math = enrollment('math', 'course-math', 'Math', everyDay(2))
    const input = request([dropped, math], ['drop'], [replacement('course-new', 'New Course')], [
      section('new-popular', 'course-new', 'New Course', everyDay(2), { active_enrollment_count: 50 }),
      section('new-direct', 'course-new', 'New Course', everyDay(3), { active_enrollment_count: 1 }),
      section('math-alternative', 'course-math', 'Math', everyDay(4)),
    ])

    const outcome = predictSchedules(input)
    expect(outcome.results).toHaveLength(2)
    expect(outcome.results.map((result) => result.collateral_change_count)).toEqual([0, 1])
    expect(outcome.results[0].schedule).toContainEqual(expect.objectContaining({ class_id: 'new-direct' }))
    expect(outcome.results[1].explanations.join(' ')).toContain('Collateral change: moved Math')
  })

  it('moves one conflicting unchanged course in Stage 2 and explains the exact blocker', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1))
    const english = enrollment('english', 'course-english', 'English', everyDay(4))
    const input = request([dropped, english], ['drop'], [replacement('course-biology', 'Biology')], [
      section('biology-a4', 'course-biology', 'Biology', everyDay(4)),
      section('english-a5', 'course-english', 'English', everyDay(5), { teacher_last_name: 'Carter' }),
    ])

    const result = predictSchedules(input).results[0]
    expect(result).toMatchObject({ collateral_change_count: 1, search_stage: 'one_collateral_change' })
    expect(result.schedule).toContainEqual(expect.objectContaining({ class_id: 'english-a5', changed_from_enrollment_id: 'english' }))
    expect(result.explanations.join(' ')).toContain('requested Biology overlaps at P4 during Full Year')
  })

  it('continues a displacement chain and always counts unrelated courses rather than meeting slots', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1))
    const english = enrollment('english', 'course-english', 'English', everyDay(2))
    const history = enrollment('history', 'course-history', 'History', everyDay(3))
    const input = request([dropped, english, history], ['drop'], [replacement('course-new', 'New Course')], [
      section('new-p2', 'course-new', 'New Course', everyDay(2)),
      section('english-p3', 'course-english', 'English', everyDay(3)),
      section('history-p4', 'course-history', 'History', everyDay(4)),
    ])

    const result = predictSchedules(input).results[0]
    expect(result).toMatchObject({ collateral_change_count: 2, search_stage: 'displacement_chain' })
    expect(result.schedule.map((item) => item.class_id)).toEqual(expect.arrayContaining(['new-p2', 'english-p3', 'history-p4']))
    expect(result.explanations.filter((line) => line.startsWith('Collateral change:'))).toHaveLength(2)
  })

  it('stops at the configured displacement depth and returns a useful no-solution explanation', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1))
    const english = enrollment('english', 'course-english', 'English', everyDay(2))
    const history = enrollment('history', 'course-history', 'History', everyDay(3))
    const input = request([dropped, english, history], ['drop'], [replacement('course-new', 'New Course')], [
      section('new-p2', 'course-new', 'New Course', everyDay(2)),
      section('english-p3', 'course-english', 'English', everyDay(3)),
      section('history-p4', 'course-history', 'History', everyDay(4)),
    ])

    const outcome = predictSchedules(input, 1)
    expect(outcome.results).toEqual([])
    expect(outcome.no_valid_schedule_reason).toContain('more than the configured limit of 1 unrelated course change')
  })

  it('models conflicts by exact semester as well as A/B day and period', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1), { academic_term: 'semester_1' })
    const semesterTwo = enrollment('s2', 'course-s2', 'Semester Two', everyDay(4), { academic_term: 'semester_2', course_term_policy: 'semester' })
    const input = request([dropped, semesterTwo], ['drop'], [replacement('course-new', 'New Course', 'semester')], [
      section('new-s1-p4', 'course-new', 'New Course', everyDay(4), {
        course_term_policy: 'semester', default_academic_term: 'semester_1', academic_term: 'semester_1',
      }),
    ])

    expect(predictSchedules(input).results[0]).toMatchObject({ collateral_change_count: 0 })
  })

  it('supports one double-period course versus two separate courses in either direction', () => {
    const doubleSlots: MeetingSlot[] = [
      { day_type: 'A', period_number: 1 },
      { day_type: 'A', period_number: 2 },
      { day_type: 'B', period_number: 1 },
    ]
    const double = enrollment('double', 'course-double-old', 'Old Double', doubleSlots, { is_double_period: true })
    const twoTargets = request([double], ['double'], [replacement('course-one', 'Course One'), replacement('course-two', 'Course Two')], [
      section('one-p1', 'course-one', 'Course One', everyDay(1)),
      section('two-a2', 'course-two', 'Course Two', [{ day_type: 'A', period_number: 2 }]),
    ])
    expect(predictSchedules(twoTargets).results[0].schedule.filter((item) => item.changed_from_enrollment_id)).toHaveLength(2)

    const first = enrollment('first', 'course-first', 'First', everyDay(1))
    const second = enrollment('second', 'course-second', 'Second', [{ day_type: 'A', period_number: 2 }])
    const oneTarget = request([first, second], ['first', 'second'], [replacement('course-double-new', 'New Double')], [
      section('new-double', 'course-double-new', 'New Double', doubleSlots, { is_double_period: true }),
    ])
    const result = predictSchedules(oneTarget).results[0]
    expect(result.schedule).toHaveLength(1)
    expect(result.schedule[0]).toMatchObject({ class_id: 'new-double', is_double_period: true })
  })

  it.each(['Journalism - NAEye News', 'Executive Functioning', '9th Grade Chorus', '10th Grade Chorus'])(
    'accepts an existing full-year one-day section for %s',
    (courseName) => {
      const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(6))
      const courseId = `course-${courseName}`
      const input = request([dropped], ['drop'], [replacement(courseId, courseName, 'sectioned_attendance')], [
        section(`section-${courseName}`, courseId, courseName, [{ day_type: 'A', period_number: 6 }], {
          course_term_policy: 'sectioned_attendance',
        }),
      ])
      expect(predictSchedules(input).results[0].schedule[0]).toMatchObject({ academic_term: 'full_year', meeting_slots: [{ day_type: 'A', period_number: 6 }] })
    },
  )

  it('uses an existing flexible-attendance pattern without inventing another one', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(7))
    const input = request([dropped], ['drop'], [replacement('course-study', 'Study Hall', 'flexible_attendance')], [
      section('study-group', 'course-study', 'Study Hall', [{ day_type: 'B', period_number: 7 }], {
        course_term_policy: 'flexible_attendance',
        pattern_source: 'existing_enrollment',
      }),
    ])
    const predicted = predictSchedules(input).results[0].schedule[0]
    expect(predicted).toMatchObject({ class_id: 'study-group', meeting_slots: [{ day_type: 'B', period_number: 7 }] })
  })

  it('expands a full-year Lunch replacement into matching existing semester sections', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(5))
    const lunchOne = section('lunch-s1', 'course-lunch', 'Lunch', everyDay(5), {
      course_term_policy: 'lunch', teacher_last_name: 'N/A', default_academic_term: 'semester_1', academic_term: 'semester_1',
    })
    const lunchTwo = section('lunch-s2', 'course-lunch', 'Lunch', everyDay(5), {
      course_term_policy: 'lunch', teacher_last_name: 'N/A', default_academic_term: 'semester_2', academic_term: 'semester_2',
    })
    const input = request([dropped], ['drop'], [replacement('course-lunch', 'Lunch', 'lunch')], [lunchOne, lunchTwo])
    const lunch = predictSchedules(input).results[0].schedule
    expect(lunch.map((item) => item.academic_term)).toEqual(['semester_1', 'semester_2'])

    const missingPair = predictSchedules({ ...input, available_sections: [lunchOne] })
    expect(missingPair.results).toEqual([])
    expect(missingPair.no_valid_schedule_reason).toContain('matching existing Semester 1 and Semester 2 sections')
  })

  it('rejects four-slot double patterns and removes duplicate predictions', () => {
    const dropped = enrollment('drop', 'course-drop', 'Dropped', everyDay(1))
    const fourSlots: MeetingSlot[] = [
      { day_type: 'A', period_number: 1 }, { day_type: 'A', period_number: 2 },
      { day_type: 'B', period_number: 1 }, { day_type: 'B', period_number: 2 },
    ]
    const invalid = request([dropped], ['drop'], [replacement('course-new', 'New Course')], [
      section('new-invalid', 'course-new', 'New Course', fourSlots, { is_double_period: true }),
    ])
    expect(predictSchedules(invalid).results).toEqual([])

    const validSection = section('new-valid', 'course-new', 'New Course', everyDay(1))
    const duplicate = { ...validSection, pattern_source: 'existing_enrollment' as const, active_enrollment_count: 20 }
    const deduplicated = predictSchedules({ ...invalid, available_sections: [validSection, duplicate] })
    expect(deduplicated.results).toHaveLength(1)
  })

  it('parses the administrator-configurable collateral depth safely', () => {
    expect(maxCollateralChangesFromEnvironment(undefined)).toBe(5)
    expect(maxCollateralChangesFromEnvironment('8')).toBe(8)
    expect(() => maxCollateralChangesFromEnvironment('2.5')).toThrow('must be an integer')
    expect(() => maxCollateralChangesFromEnvironment('21')).toThrow('must be an integer')
  })
})
