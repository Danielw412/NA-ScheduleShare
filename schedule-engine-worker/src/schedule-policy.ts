import { createPredictionFunction } from './prediction-engine.js'
import type {
  CurrentScheduleEnrollment,
  ExistingSectionPlacement,
  PredictedScheduleEnrollment,
  PredictedScheduleResult,
  PredictionFunction,
  PredictionOutcome,
  ReplacementCourse,
  ScheduleEngineInput,
} from './types.js'

const MAX_RESULTS = 3
const REQUIRED_PERIODS = 9

type Semester = 'semester_1' | 'semester_2'

interface CoverageIssue {
  term: Semester
  day: 'A' | 'B'
  period: number
  count: number
}

interface NormalizedStudyHallInput {
  input: ScheduleEngineInput
  aliasToRealCourseId: Map<string, string>
}

function isStudyHallName(courseName: string): boolean {
  return /^study hall\b/i.test(courseName.trim())
}

/** One unit equals 0.5 credits. */
export function scheduleEngineCreditUnits(
  enrollment: Pick<CurrentScheduleEnrollment, 'academic_term' | 'is_double_period' | 'meeting_slots'>,
): number {
  if (enrollment.meeting_slots.length === 0) return 0
  if (enrollment.academic_term !== 'full_year') return 1
  if (enrollment.is_double_period) return 3
  return new Set(enrollment.meeting_slots.map((slot) => slot.day_type)).size === 1 ? 1 : 2
}

function creditLabel(units: number): string {
  const credits = units / 2
  return Number.isInteger(credits) ? credits.toFixed(1) : String(credits)
}

export function scheduleEngineCoverageIssues(
  enrollments: Array<Pick<CurrentScheduleEnrollment, 'academic_term' | 'meeting_slots'>>,
): CoverageIssue[] {
  const counts = new Map<string, number>()
  for (const enrollment of enrollments) {
    const terms: Semester[] = enrollment.academic_term === 'full_year'
      ? ['semester_1', 'semester_2']
      : [enrollment.academic_term]
    for (const term of terms) {
      for (const slot of enrollment.meeting_slots) {
        const key = `${term}:${slot.day_type}:${slot.period_number}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }

  const issues: CoverageIssue[] = []
  for (const term of ['semester_1', 'semester_2'] as const) {
    for (const day of ['A', 'B'] as const) {
      for (let period = 1; period <= REQUIRED_PERIODS; period += 1) {
        const count = counts.get(`${term}:${day}:${period}`) ?? 0
        if (count !== 1) issues.push({ term, day, period, count })
      }
    }
  }
  return issues
}

function firstCoverageLabel(issue: CoverageIssue): string {
  return `${issue.term === 'semester_1' ? 'S1' : 'S2'} ${issue.day}${issue.period}`
}

function studyHallAlias(realCourseId: string, scope: string, index: number): string {
  return `${realCourseId}::schedule-policy::${scope}-${index + 1}`
}

function normalizeStudyHallIds(input: ScheduleEngineInput): NormalizedStudyHallInput {
  const aliasToRealCourseId = new Map<string, string>()
  const currentAliasByEnrollmentId = new Map<string, string>()

  const currentSchedule = input.current_schedule.map((enrollment, index) => {
    if (!isStudyHallName(enrollment.course_name)) return enrollment
    const alias = studyHallAlias(enrollment.course_id, 'current', index)
    aliasToRealCourseId.set(alias, enrollment.course_id)
    currentAliasByEnrollmentId.set(enrollment.enrollment_id, alias)
    return { ...enrollment, course_id: alias }
  })

  const sourceCourses = input.source_courses.map((source) => {
    const alias = currentAliasByEnrollmentId.get(source.enrollment_id)
    return alias ? { ...source, current_course: { ...source.current_course, course_id: alias } } : source
  })

  const replacementCourses = input.replacement_courses.map((course, index) => {
    if (!isStudyHallName(course.course_name)) return course
    const alias = studyHallAlias(course.course_id, 'target', index)
    aliasToRealCourseId.set(alias, course.course_id)
    return { ...course, course_id: alias }
  })

  const studyHallAliasesByRealId = new Map<string, string[]>()
  for (const [alias, realId] of aliasToRealCourseId) {
    const aliases = studyHallAliasesByRealId.get(realId) ?? []
    aliases.push(alias)
    studyHallAliasesByRealId.set(realId, aliases)
  }

  const availableSections: ExistingSectionPlacement[] = [...input.available_sections]
  for (const section of input.available_sections) {
    const aliases = studyHallAliasesByRealId.get(section.course_id)
    if (!aliases) continue
    for (const alias of aliases) availableSections.push({ ...section, course_id: alias })
  }

  return {
    input: {
      ...input,
      current_schedule: currentSchedule,
      source_courses: sourceCourses,
      replacement_courses: replacementCourses,
      available_sections: availableSections,
    },
    aliasToRealCourseId,
  }
}

function restoreCourseIds(result: PredictedScheduleResult, aliases: Map<string, string>): PredictedScheduleResult {
  return {
    ...result,
    schedule: result.schedule.map((enrollment) => ({
      ...enrollment,
      course_id: aliases.get(enrollment.course_id) ?? enrollment.course_id,
    })),
  }
}

function autoStudyHallVariant(input: ScheduleEngineInput): ScheduleEngineInput | null {
  const studyHalls = input.replacement_courses.filter((course) => isStudyHallName(course.course_name))
  if (studyHalls.length !== 1 || input.replacement_courses.length >= 3) return null
  const duplicate: ReplacementCourse = {
    ...studyHalls[0],
    position: Math.max(...input.replacement_courses.map((course) => course.position), 0) + 1,
  }
  return { ...input, replacement_courses: [...input.replacement_courses, duplicate] }
}

function requestedReplacementCreditUnits(result: PredictedScheduleResult, sourceEnrollmentIds: ReadonlySet<string>): number {
  return result.schedule.reduce((total, enrollment) => (
    enrollment.changed_from_enrollment_id && sourceEnrollmentIds.has(enrollment.changed_from_enrollment_id)
      ? total + scheduleEngineCreditUnits(enrollment)
      : total
  ), 0)
}

function scheduleSignature(schedule: PredictedScheduleEnrollment[]): string {
  return schedule.map((enrollment) => {
    const slots = [...enrollment.meeting_slots]
      .sort((left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number)
      .map((slot) => `${slot.day_type}${slot.period_number}`)
      .join(',')
    return `${enrollment.course_id}|${enrollment.class_id}|${enrollment.academic_term}|${slots}`
  }).sort().join('::')
}

export async function predictWithSchedulePolicy(
  input: ScheduleEngineInput,
  corePredict: PredictionFunction,
): Promise<PredictionOutcome> {
  const currentCoverageIssues = scheduleEngineCoverageIssues(input.current_schedule)
  if (currentCoverageIssues.length > 0) {
    const first = currentCoverageIssues[0]
    return {
      results: [],
      no_valid_schedule_reason: `Your current schedule must be fully filled before Schedule Engine can run. Every A/B period 1–9 must contain exactly one class in both semesters. First issue: ${firstCoverageLabel(first)} is ${first.count === 0 ? 'empty' : 'filled more than once'}.`,
    }
  }

  const sourceEnrollmentIds = new Set(input.source_courses.map((source) => source.enrollment_id))
  const sourceCreditUnits = input.source_courses.reduce((total, source) => total + scheduleEngineCreditUnits(source.current_course), 0)
  const variants: Array<{ input: ScheduleEngineInput; autoExpandedStudyHall: boolean }> = [
    { input, autoExpandedStudyHall: false },
  ]
  const autoVariant = autoStudyHallVariant(input)
  if (autoVariant) variants.push({ input: autoVariant, autoExpandedStudyHall: true })

  const candidates: Array<{ result: PredictedScheduleResult; variantIndex: number; resultIndex: number }> = []
  const coreReasons: string[] = []
  let sawCreditMismatch = false
  let sawIncompleteResult = false

  for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
    const variant = variants[variantIndex]
    const normalized = normalizeStudyHallIds(variant.input)
    const outcome = await corePredict(normalized.input)
    if (outcome.results.length === 0 && outcome.no_valid_schedule_reason) coreReasons.push(outcome.no_valid_schedule_reason)

    for (let resultIndex = 0; resultIndex < outcome.results.length; resultIndex += 1) {
      let result = restoreCourseIds(outcome.results[resultIndex], normalized.aliasToRealCourseId)
      if (requestedReplacementCreditUnits(result, sourceEnrollmentIds) !== sourceCreditUnits) {
        sawCreditMismatch = true
        continue
      }
      if (scheduleEngineCoverageIssues(result.schedule).length > 0) {
        sawIncompleteResult = true
        continue
      }
      if (variant.autoExpandedStudyHall) {
        result = {
          ...result,
          explanations: [
            ...result.explanations,
            'Credit balance: one Study Hall selection was expanded to two half-credit Study Halls.',
          ],
        }
      }
      candidates.push({ result, variantIndex, resultIndex })
    }
  }

  const unique = new Map<string, { result: PredictedScheduleResult; variantIndex: number; resultIndex: number }>()
  for (const candidate of candidates) {
    const key = scheduleSignature(candidate.result.schedule)
    if (!unique.has(key)) unique.set(key, candidate)
  }
  const ranked = [...unique.values()].sort((left, right) => (
    left.result.collateral_change_count - right.result.collateral_change_count
    || left.variantIndex - right.variantIndex
    || left.resultIndex - right.resultIndex
  ))

  if (ranked.length > 0) return { results: ranked.slice(0, MAX_RESULTS).map((candidate) => candidate.result), no_valid_schedule_reason: null }
  if (sawIncompleteResult) {
    return {
      results: [],
      no_valid_schedule_reason: 'The available replacement sections would leave at least one A/B period empty. Schedule Engine only returns fully filled schedules for both semesters.',
    }
  }
  if (coreReasons.length > 0) return { results: [], no_valid_schedule_reason: coreReasons[0] }
  if (sawCreditMismatch) {
    return {
      results: [],
      no_valid_schedule_reason: `The replacement side must equal the ${creditLabel(sourceCreditUnits)} credits being removed. Semester or A/B-only full-year courses count as 0.5 credits, full-year courses as 1.0, and double-period courses as 1.5.`,
    }
  }
  return { results: [], no_valid_schedule_reason: 'No valid fully filled, credit-balanced schedule was found using the existing sections.' }
}

export function createSchedulePolicyPredictionFunction(options: { maxCollateralChanges?: number } = {}): PredictionFunction {
  const corePredict = createPredictionFunction(options)
  return async (input) => predictWithSchedulePolicy(input, corePredict)
}
