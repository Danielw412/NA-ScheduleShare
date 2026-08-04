import type { PredictedScheduleEnrollment, PredictedScheduleResult, PredictionFunction, ScheduleEngineInput } from './types.js'

export class PredictionEngineNotImplementedError extends Error {
  constructor() {
    super('Schedule prediction is not implemented yet.')
    this.name = 'PredictionEngineNotImplementedError'
  }
}

export function developmentPlaceholderAllowed(supabaseUrl: string, enabled: string | undefined, nodeEnvironment: string | undefined): boolean {
  if (enabled !== 'true' || nodeEnvironment === 'production') return false
  try {
    const hostname = new URL(supabaseUrl).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function createDevelopmentPlaceholder(input: ScheduleEngineInput): PredictedScheduleResult {
  if (input.source_courses.length !== 1 || input.replacement_courses.length !== 1) {
    throw new PredictionEngineNotImplementedError()
  }
  const source = input.source_courses[0]
  const replacementCourse = input.replacement_courses[0]
  const schedule: PredictedScheduleEnrollment[] = input.current_schedule.map((enrollment) => {
    if (enrollment.enrollment_id !== source.enrollment_id) return { ...enrollment, changed_from_enrollment_id: null }
    return {
      ...enrollment,
      enrollment_id: `development-placeholder-${source.position}`,
      class_id: `development-placeholder-${replacementCourse.course_id}`,
      course_id: replacementCourse.course_id,
      course_name: replacementCourse.course_name,
      course_term_policy: replacementCourse.course_term_policy,
      teacher_last_name: 'TBD',
      changed_from_enrollment_id: enrollment.enrollment_id,
    }
  })
  return { schedule, development_placeholder: true }
}

export function createPredictionFunction(options: { allowDevelopmentPlaceholder: boolean }): PredictionFunction {
  return async (input) => {
    if (!options.allowDevelopmentPlaceholder) throw new PredictionEngineNotImplementedError()
    return [createDevelopmentPlaceholder(input)]
  }
}

// Replace createPredictionFunction with the real engine entrypoint later. Keep
// conflict solving, ranking, and confidence calculation out of the queue layer.
