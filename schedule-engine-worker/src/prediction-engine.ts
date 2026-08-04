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
  const replacements = new Map(input.replacements.map((replacement) => [replacement.enrollment_id, replacement]))
  const schedule: PredictedScheduleEnrollment[] = input.current_schedule.map((enrollment) => {
    const replacement = replacements.get(enrollment.enrollment_id)
    if (!replacement) return { ...enrollment, changed_from_enrollment_id: null }
    return {
      ...enrollment,
      enrollment_id: `development-placeholder-${replacement.position}`,
      class_id: `development-placeholder-${replacement.replacement_course.course_id}`,
      course_id: replacement.replacement_course.course_id,
      course_name: replacement.replacement_course.course_name,
      course_term_policy: replacement.replacement_course.course_term_policy,
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
