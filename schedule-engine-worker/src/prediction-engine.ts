import type {
  AcademicTerm,
  CurrentScheduleEnrollment,
  ExistingSectionPlacement,
  MeetingSlot,
  PredictedScheduleEnrollment,
  PredictedScheduleResult,
  PredictionFunction,
  PredictionOutcome,
  ReplacementCourse,
  ScheduleEngineInput,
} from './types.js'

const MAX_RESULTS = 3
const DEFAULT_MAX_COLLATERAL_CHANGES = 5
const MAX_CONFIGURED_COLLATERAL_CHANGES = 20
const MAX_SEARCH_STATES = 100_000

interface PlacementOption {
  key: string
  placements: ExistingSectionPlacement[]
  popularity: number
}

interface TargetGroup {
  course: ReplacementCourse
  options: PlacementOption[]
}

interface CurrentGroup {
  id: string
  label: string
  originals: CurrentScheduleEnrollment[]
  options: PlacementOption[]
}

interface SearchState {
  targetChoices: number[]
  currentChoices: number[]
}

interface AssignedEntity {
  kind: 'target' | 'current'
  index: number
  label: string
  option: PlacementOption
}

interface ScheduleIssue {
  kind: 'invalid' | 'conflict'
  left: AssignedEntity
  right?: AssignedEntity
  detail: string
}

interface RankedSolution {
  state: SearchState
  collateralCount: number
  popularity: number
  scheduleKey: string
}

class PriorityQueue<T> {
  private readonly values: T[] = []

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get length(): number {
    return this.values.length
  }

  push(value: T): void {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.compare(this.values[parent], this.values[index]) <= 0) break
      const parentValue = this.values[parent]
      this.values[parent] = this.values[index]
      this.values[index] = parentValue
      index = parent
    }
  }

  shift(): T | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (this.values.length === 0 || last === undefined) return first
    this.values[0] = last
    let index = 0
    while (true) {
      const left = (index * 2) + 1
      const right = left + 1
      let best = index
      if (left < this.values.length && this.compare(this.values[left], this.values[best]) < 0) best = left
      if (right < this.values.length && this.compare(this.values[right], this.values[best]) < 0) best = right
      if (best === index) break
      const currentValue = this.values[index]
      this.values[index] = this.values[best]
      this.values[best] = currentValue
      index = best
    }
    return first
  }
}

const termLabels: Record<AcademicTerm, string> = {
  full_year: 'Full Year',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
}

function sortedSlots(slots: MeetingSlot[]): MeetingSlot[] {
  return [...slots].sort((left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number)
}

function slotKey(slots: MeetingSlot[]): string {
  return sortedSlots(slots).map((slot) => `${slot.day_type}${slot.period_number}`).join(',')
}

function placementKey(placement: Pick<ExistingSectionPlacement, 'class_id' | 'academic_term' | 'meeting_slots'>): string {
  return `${placement.class_id}|${placement.academic_term}|${slotKey(placement.meeting_slots)}`
}

function optionFrom(placements: ExistingSectionPlacement[]): PlacementOption {
  const ordered = [...placements].sort((left, right) => placementKey(left).localeCompare(placementKey(right)))
  return {
    key: ordered.map(placementKey).join('::'),
    placements: ordered,
    popularity: ordered.reduce((total, placement) => total + Math.max(0, placement.active_enrollment_count), 0),
  }
}

function currentPlacement(enrollment: CurrentScheduleEnrollment): ExistingSectionPlacement {
  return {
    course_id: enrollment.course_id,
    course_name: enrollment.course_name,
    course_term_policy: enrollment.course_term_policy,
    class_id: enrollment.class_id,
    teacher_last_name: enrollment.teacher_last_name,
    default_academic_term: enrollment.academic_term,
    academic_term: enrollment.academic_term,
    is_double_period: enrollment.is_double_period,
    meeting_slots: sortedSlots(enrollment.meeting_slots),
    active_enrollment_count: 0,
    pattern_source: 'existing_enrollment',
  }
}

function termsOverlap(left: AcademicTerm, right: AcademicTerm): boolean {
  return left === 'full_year' || right === 'full_year' || left === right
}

function overlappingTermLabel(left: AcademicTerm, right: AcademicTerm): string {
  if (left === right) return termLabels[left]
  if (left === 'full_year') return termLabels[right]
  if (right === 'full_year') return termLabels[left]
  return `${termLabels[left]} / ${termLabels[right]}`
}

function formatSlots(slots: MeetingSlot[]): string {
  const daysByPeriod = new Map<number, Set<'A' | 'B'>>()
  for (const slot of sortedSlots(slots)) {
    const days = daysByPeriod.get(slot.period_number) ?? new Set<'A' | 'B'>()
    days.add(slot.day_type)
    daysByPeriod.set(slot.period_number, days)
  }
  return [...daysByPeriod.entries()].sort(([left], [right]) => left - right).map(([period, days]) => (
    days.has('A') && days.has('B') ? `P${period}` : `${days.has('A') ? 'A' : 'B'}${period}`
  )).join(' + ')
}

function placementValidationError(placement: ExistingSectionPlacement): string | null {
  const slots = sortedSlots(placement.meeting_slots)
  if (slots.length === 0) return 'has no meeting slots'
  if (slots.length > 3) return 'uses more than three meeting slots'
  const uniqueSlots = new Set<string>()
  for (const slot of slots) {
    if ((slot.day_type !== 'A' && slot.day_type !== 'B') || !Number.isInteger(slot.period_number) || slot.period_number < 1 || slot.period_number > 9) {
      return 'contains an invalid A/B day or period'
    }
    const key = `${slot.day_type}-${slot.period_number}`
    if (uniqueSlots.has(key)) return 'contains a duplicate meeting slot'
    uniqueSlots.add(key)
  }

  const byDay = (['A', 'B'] as const).map((day) => slots.filter((slot) => slot.day_type === day))
  if (!placement.is_double_period && byDay.some((daySlots) => daySlots.length > 1)) return 'uses multiple periods but is not a double-period section'
  if (placement.is_double_period) {
    let hasDoubleDay = false
    for (const daySlots of byDay) {
      if (daySlots.length > 2) return 'uses more than two periods on one day'
      if (daySlots.length === 2) {
        if (daySlots[1].period_number !== daySlots[0].period_number + 1) return 'uses non-consecutive double periods'
        hasDoubleDay = true
      }
    }
    if (!hasDoubleDay) return 'is marked double-period without consecutive periods'
  }

  if (placement.course_term_policy === 'full_year' && placement.academic_term !== 'full_year') return 'does not use a full-year term'
  if (placement.course_term_policy === 'flexible_attendance' || placement.course_term_policy === 'sectioned_attendance') {
    const aSlots = slots.filter((slot) => slot.day_type === 'A')
    const bSlots = slots.filter((slot) => slot.day_type === 'B')
    const fullYearStudyHallEveryDay = /^study hall(?:\s*-\s*(?:nai|nash))?$/i.test(placement.course_name.trim())
      && slots.length === 2
      && aSlots.length === 1
      && bSlots.length === 1
      && aSlots[0].period_number === bSlots[0].period_number
    if (placement.academic_term === 'full_year') {
      if (slots.length !== 1 && !fullYearStudyHallEveryDay) return 'must meet on one day type or, for Study Hall, the same period every day when full-year'
    } else if (slots.length !== 2 || aSlots.length !== 1 || bSlots.length !== 1 || aSlots[0].period_number !== bSlots[0].period_number) {
      return 'must meet every day in the same period when semester-long'
    }
  }
  if (placement.course_term_policy === 'lunch') {
    const aSlots = slots.filter((slot) => slot.day_type === 'A')
    const bSlots = slots.filter((slot) => slot.day_type === 'B')
    if (placement.academic_term === 'full_year') return 'must be represented by separate Semester 1 and Semester 2 enrollments'
    if (slots.length !== 2 || aSlots.length !== 1 || bSlots.length !== 1 || aSlots[0].period_number !== bSlots[0].period_number) {
      return 'must meet every day in the same period'
    }
  }
  return null
}

function conflictDetail(left: ExistingSectionPlacement, right: ExistingSectionPlacement): string | null {
  if (!termsOverlap(left.academic_term, right.academic_term)) return null
  const term = overlappingTermLabel(left.academic_term, right.academic_term)
  if (left.course_id === right.course_id) return `duplicates the same course during ${term}`
  if (left.course_term_policy === 'lunch' && right.course_term_policy === 'lunch') return `duplicates Lunch during ${term}`
  const sharedSlots = left.meeting_slots.filter((slot) => right.meeting_slots.some((candidate) => (
    candidate.day_type === slot.day_type && candidate.period_number === slot.period_number
  )))
  return sharedSlots.length > 0 ? `overlaps at ${formatSlots(sharedSlots)} during ${term}` : null
}

function optionIsLegal(option: PlacementOption): boolean {
  if (option.placements.some((placement) => placementValidationError(placement))) return false
  for (let left = 0; left < option.placements.length; left += 1) {
    for (let right = left + 1; right < option.placements.length; right += 1) {
      if (conflictDetail(option.placements[left], option.placements[right])) return false
    }
  }
  return true
}

function deduplicatedLegalPlacements(courseId: string, placements: ExistingSectionPlacement[]): ExistingSectionPlacement[] {
  const unique = new Map<string, ExistingSectionPlacement>()
  for (const placement of placements) {
    if (placement.course_id !== courseId || placementValidationError(placement)) continue
    const key = placementKey(placement)
    const existing = unique.get(key)
    if (!existing || placement.active_enrollment_count > existing.active_enrollment_count) unique.set(key, { ...placement, meeting_slots: sortedSlots(placement.meeting_slots) })
  }
  return [...unique.values()].sort((left, right) => (
    right.active_enrollment_count - left.active_enrollment_count || placementKey(left).localeCompare(placementKey(right))
  ))
}

function needsFullYearLunch(terms: AcademicTerm[]): boolean {
  return terms.includes('full_year') || (terms.includes('semester_1') && terms.includes('semester_2'))
}

function lunchOptions(placements: ExistingSectionPlacement[], desiredTerms: AcademicTerm[]): PlacementOption[] {
  const semesterPlacements = placements.filter((placement) => placement.academic_term !== 'full_year')
  if (!needsFullYearLunch(desiredTerms)) {
    const desiredTerm = desiredTerms.includes('semester_2') ? 'semester_2' : 'semester_1'
    return semesterPlacements.filter((placement) => placement.academic_term === desiredTerm).map((placement) => optionFrom([placement]))
  }

  const firstSemester = semesterPlacements.filter((placement) => placement.academic_term === 'semester_1')
  const secondSemester = semesterPlacements.filter((placement) => placement.academic_term === 'semester_2')
  const options: PlacementOption[] = []
  for (const first of firstSemester) {
    for (const second of secondSemester) {
      if (slotKey(first.meeting_slots) !== slotKey(second.meeting_slots)) continue
      if (first.teacher_last_name.trim().toLocaleLowerCase() !== second.teacher_last_name.trim().toLocaleLowerCase()) continue
      options.push(optionFrom([first, second]))
    }
  }
  return options
}

function courseOptions(
  course: Pick<ReplacementCourse, 'course_id' | 'course_term_policy'>,
  allPlacements: ExistingSectionPlacement[],
  desiredTerms: AcademicTerm[],
  preserveExactTerm: boolean,
): PlacementOption[] {
  let placements = deduplicatedLegalPlacements(course.course_id, allPlacements)
  if (course.course_term_policy === 'lunch') return deduplicateOptions(lunchOptions(placements, desiredTerms))
  if (preserveExactTerm && desiredTerms.length === 1) placements = placements.filter((placement) => placement.academic_term === desiredTerms[0])
  return deduplicateOptions(placements.map((placement) => optionFrom([placement])))
}

function deduplicateOptions(options: PlacementOption[]): PlacementOption[] {
  const unique = new Map<string, PlacementOption>()
  for (const option of options) {
    if (!optionIsLegal(option)) continue
    const existing = unique.get(option.key)
    if (!existing || option.popularity > existing.popularity) unique.set(option.key, option)
  }
  return [...unique.values()].sort((left, right) => right.popularity - left.popularity || left.key.localeCompare(right.key))
}

function buildCurrentGroups(input: ScheduleEngineInput): CurrentGroup[] {
  const removed = new Set(input.source_courses.map((source) => source.enrollment_id))
  const remaining = input.current_schedule.filter((enrollment) => !removed.has(enrollment.enrollment_id))
  const consumed = new Set<string>()
  const groups: CurrentGroup[] = []

  for (const enrollment of remaining) {
    if (consumed.has(enrollment.enrollment_id)) continue
    const originals = [enrollment]
    consumed.add(enrollment.enrollment_id)
    if (enrollment.course_term_policy === 'lunch' && (enrollment.academic_term === 'semester_1' || enrollment.academic_term === 'semester_2')) {
      const otherTerm = enrollment.academic_term === 'semester_1' ? 'semester_2' : 'semester_1'
      const pair = remaining.find((candidate) => (
        !consumed.has(candidate.enrollment_id)
        && candidate.course_id === enrollment.course_id
        && candidate.course_term_policy === 'lunch'
        && candidate.academic_term === otherTerm
        && slotKey(candidate.meeting_slots) === slotKey(enrollment.meeting_slots)
      ))
      if (pair) {
        originals.push(pair)
        consumed.add(pair.enrollment_id)
      }
    }

    const original = optionFrom(originals.map(currentPlacement))
    const alternatives = courseOptions({
      course_id: enrollment.course_id,
      course_term_policy: enrollment.course_term_policy,
    }, input.available_sections, originals.map((item) => item.academic_term), true).filter((option) => option.key !== original.key)
    groups.push({
      id: originals.map((item) => item.enrollment_id).join(':'),
      label: enrollment.course_name,
      originals,
      options: [original, ...alternatives],
    })
  }
  return groups
}

function buildTargetGroups(input: ScheduleEngineInput): { groups: TargetGroup[]; error: string | null } {
  const sourceTerms = input.source_courses.map((source) => source.current_course.academic_term)
  const groups = [...input.replacement_courses].sort((left, right) => left.position - right.position).map((course) => ({
    course,
    options: courseOptions(course, input.available_sections, sourceTerms, false),
  }))
  const missing = groups.find((group) => group.options.length === 0)
  if (!missing) return { groups, error: null }
  const lunchDetail = missing.course.course_term_policy === 'lunch' && needsFullYearLunch(sourceTerms)
    ? ' A full-year Lunch replacement requires matching existing Semester 1 and Semester 2 sections at the same period.'
    : ''
  return {
    groups,
    error: `No valid schedule exists because ${missing.course.course_name} has no active existing section with a legal meeting pattern.${lunchDetail}`,
  }
}

function enumerateTargetChoices(groups: TargetGroup[]): number[][] {
  const choices: number[][] = []
  function visit(index: number, current: number[]) {
    if (index === groups.length) {
      choices.push([...current])
      return
    }
    for (let optionIndex = 0; optionIndex < groups[index].options.length; optionIndex += 1) {
      current.push(optionIndex)
      visit(index + 1, current)
      current.pop()
    }
  }
  visit(0, [])
  return choices
}

function entitiesFor(state: SearchState, targets: TargetGroup[], current: CurrentGroup[]): AssignedEntity[] {
  return [
    ...targets.map((target, index) => ({ kind: 'target' as const, index, label: target.course.course_name, option: target.options[state.targetChoices[index]] })),
    ...current.map((group, index) => ({ kind: 'current' as const, index, label: group.label, option: group.options[state.currentChoices[index]] })),
  ]
}

function firstScheduleIssue(state: SearchState, targets: TargetGroup[], current: CurrentGroup[]): ScheduleIssue | null {
  const entities = entitiesFor(state, targets, current)
  for (const entity of entities) {
    for (const placement of entity.option.placements) {
      const invalid = placementValidationError(placement)
      if (invalid) return { kind: 'invalid', left: entity, detail: invalid }
    }
  }
  for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex += 1) {
      for (const left of entities[leftIndex].option.placements) {
        for (const right of entities[rightIndex].option.placements) {
          const detail = conflictDetail(left, right)
          if (detail) return { kind: 'conflict', left: entities[leftIndex], right: entities[rightIndex], detail }
        }
      }
    }
  }
  return null
}

function collateralCount(state: SearchState): number {
  return state.currentChoices.filter((choice) => choice !== 0).length
}

function statePopularity(state: SearchState, targets: TargetGroup[], current: CurrentGroup[]): number {
  return targets.reduce((total, group, index) => total + group.options[state.targetChoices[index]].popularity, 0)
    + current.reduce((total, group, index) => total + (state.currentChoices[index] === 0 ? 0 : group.options[state.currentChoices[index]].popularity), 0)
}

function stateKey(state: SearchState): string {
  return `${state.targetChoices.join(',')}|${state.currentChoices.join(',')}`
}

function compareStates(left: SearchState, right: SearchState, targets: TargetGroup[], current: CurrentGroup[]): number {
  return collateralCount(left) - collateralCount(right)
    || statePopularity(right, targets, current) - statePopularity(left, targets, current)
    || stateKey(left).localeCompare(stateKey(right))
}

function branchState(
  state: SearchState,
  issue: ScheduleIssue,
  current: CurrentGroup[],
  maxCollateralChanges: number,
): { states: SearchState[]; reachedDepthLimit: boolean } {
  const mutableIndexes = [...new Set([issue.left, issue.right].flatMap((entity) => entity?.kind === 'current' ? [entity.index] : []))]
  const states: SearchState[] = []
  let reachedDepthLimit = false
  for (const groupIndex of mutableIndexes) {
    for (let optionIndex = 0; optionIndex < current[groupIndex].options.length; optionIndex += 1) {
      if (optionIndex === state.currentChoices[groupIndex]) continue
      const next = { targetChoices: state.targetChoices, currentChoices: [...state.currentChoices] }
      next.currentChoices[groupIndex] = optionIndex
      if (collateralCount(next) > maxCollateralChanges) {
        reachedDepthLimit = true
        continue
      }
      states.push(next)
    }
  }
  return { states, reachedDepthLimit }
}

function deadEndReason(issue: ScheduleIssue, current: CurrentGroup[]): string {
  if (issue.kind === 'invalid') {
    return `${issue.left.label}'s current placement ${issue.detail}, and no legal existing section can preserve that course.`
  }
  if (issue.left.kind === 'target' && issue.right?.kind === 'target') {
    return `The existing sections for ${issue.left.label} and ${issue.right.label} ${issue.detail}.`
  }
  const fixed = issue.left.kind === 'target' ? issue.left : issue.right?.kind === 'target' ? issue.right : null
  const movable = issue.left.kind === 'current' ? issue.left : issue.right?.kind === 'current' ? issue.right : null
  if (fixed && movable && current[movable.index].options.length === 1) {
    return `${fixed.label} ${issue.detail} with ${movable.label}, which has no other legal existing section for that term.`
  }
  return `${issue.left.label}${issue.right ? ` and ${issue.right.label}` : ''} ${issue.detail}, and the conflict cannot be resolved with the available sections.`
}

function matchOriginal(placement: ExistingSectionPlacement, originals: CurrentScheduleEnrollment[], used: Set<string>): CurrentScheduleEnrollment {
  return originals.find((original) => !used.has(original.enrollment_id) && original.academic_term === placement.academic_term)
    ?? originals.find((original) => !used.has(original.enrollment_id))
    ?? originals[0]
}

function predictedEnrollment(
  placement: ExistingSectionPlacement,
  enrollmentId: string,
  changedFromEnrollmentId: string | null,
): PredictedScheduleEnrollment {
  return {
    enrollment_id: enrollmentId,
    class_id: placement.class_id,
    course_id: placement.course_id,
    course_name: placement.course_name,
    course_term_policy: placement.course_term_policy,
    teacher_last_name: placement.teacher_last_name,
    academic_term: placement.academic_term,
    is_double_period: placement.is_double_period,
    meeting_slots: sortedSlots(placement.meeting_slots),
    changed_from_enrollment_id: changedFromEnrollmentId,
  }
}

function scheduleFor(state: SearchState, input: ScheduleEngineInput, targets: TargetGroup[], current: CurrentGroup[]): PredictedScheduleEnrollment[] {
  const schedule: PredictedScheduleEnrollment[] = []
  for (let groupIndex = 0; groupIndex < current.length; groupIndex += 1) {
    const group = current[groupIndex]
    const choice = state.currentChoices[groupIndex]
    if (choice === 0) {
      schedule.push(...group.originals.map((original) => ({ ...original, meeting_slots: sortedSlots(original.meeting_slots), changed_from_enrollment_id: null })))
      continue
    }
    const used = new Set<string>()
    group.options[choice].placements.forEach((placement, partIndex) => {
      const original = matchOriginal(placement, group.originals, used)
      used.add(original.enrollment_id)
      schedule.push(predictedEnrollment(placement, `predicted-${input.job.id}-move-${groupIndex + 1}-${partIndex + 1}`, original.enrollment_id))
    })
  }

  const sources = [...input.source_courses].sort((left, right) => left.position - right.position)
  targets.forEach((target, targetIndex) => {
    const source = sources[Math.min(targetIndex, sources.length - 1)]
    target.options[state.targetChoices[targetIndex]].placements.forEach((placement, partIndex) => {
      schedule.push(predictedEnrollment(
        placement,
        `predicted-${input.job.id}-replacement-${targetIndex + 1}-${partIndex + 1}`,
        source?.enrollment_id ?? null,
      ))
    })
  })
  return schedule.sort((left, right) => (
    left.academic_term.localeCompare(right.academic_term)
    || (left.meeting_slots[0]?.period_number ?? 99) - (right.meeting_slots[0]?.period_number ?? 99)
    || left.course_name.localeCompare(right.course_name)
    || left.enrollment_id.localeCompare(right.enrollment_id)
  ))
}

function scheduleSignature(schedule: PredictedScheduleEnrollment[]): string {
  return schedule.map((enrollment) => (
    `${enrollment.course_id}|${enrollment.class_id}|${enrollment.academic_term}|${slotKey(enrollment.meeting_slots)}`
  )).sort().join('::')
}

function optionDescription(option: PlacementOption): string {
  return option.placements.map((placement) => (
    `${placement.teacher_last_name} (${termLabels[placement.academic_term]}, ${formatSlots(placement.meeting_slots)})`
  )).join(' and ')
}

function explanationsFor(state: SearchState, input: ScheduleEngineInput, targets: TargetGroup[], current: CurrentGroup[]): string[] {
  const dropped = [...input.source_courses].sort((left, right) => left.position - right.position).map((source) => source.current_course.course_name).join(' + ')
  const added = targets.map((target, index) => `${target.course.course_name} with ${optionDescription(target.options[state.targetChoices[index]])}`).join('; ')
  const explanations = [`Requested change: dropped ${dropped} and added ${added}, using existing sections and meeting patterns.`]
  const finalEntities = entitiesFor(state, targets, current)

  current.forEach((group, groupIndex) => {
    const choice = state.currentChoices[groupIndex]
    if (choice === 0) return
    const blockers: string[] = []
    const original = group.options[0]
    for (const entity of finalEntities) {
      if (entity.kind === 'current' && entity.index === groupIndex) continue
      for (const originalPlacement of original.placements) {
        for (const finalPlacement of entity.option.placements) {
          const detail = conflictDetail(originalPlacement, finalPlacement)
          if (detail) blockers.push(`${entity.kind === 'target' ? 'requested ' : ''}${entity.label} ${detail}`)
        }
      }
    }
    const invalid = original.placements.map(placementValidationError).find((value): value is string => Boolean(value))
    const reason = blockers.length > 0
      ? `because ${[...new Set(blockers)].join(' and ')}`
      : invalid ? `because its original placement ${invalid}` : 'to complete the displacement chain without a conflict'
    explanations.push(`Collateral change: moved ${group.label} from ${optionDescription(original)} to ${optionDescription(group.options[choice])} ${reason}.`)
  })
  return explanations
}

function resultFor(solution: RankedSolution, input: ScheduleEngineInput, targets: TargetGroup[], current: CurrentGroup[]): PredictedScheduleResult {
  const count = solution.collateralCount
  return {
    schedule: scheduleFor(solution.state, input, targets, current),
    collateral_change_count: count,
    search_stage: count === 0 ? 'direct_replacement' : count === 1 ? 'one_collateral_change' : 'displacement_chain',
    explanations: explanationsFor(solution.state, input, targets, current),
  }
}

function validateInput(input: ScheduleEngineInput): void {
  if (input.source_courses.length < 1 || input.source_courses.length > 3 || input.replacement_courses.length < 1 || input.replacement_courses.length > 3) {
    throw new Error('Schedule Engine input must contain one to three dropped courses and one to three replacement courses.')
  }
  const currentById = new Map(input.current_schedule.map((enrollment) => [enrollment.enrollment_id, enrollment]))
  for (const source of input.source_courses) {
    const current = currentById.get(source.enrollment_id)
    if (!current || current.course_id !== source.current_course.course_id) throw new Error('A requested dropped enrollment is no longer in the current schedule.')
  }
  if (new Set(input.source_courses.map((source) => source.enrollment_id)).size !== input.source_courses.length) throw new Error('Schedule Engine input contains a duplicate dropped enrollment.')
  if (new Set(input.replacement_courses.map((course) => course.course_id)).size !== input.replacement_courses.length) throw new Error('Schedule Engine input contains a duplicate replacement course.')
}

export function predictSchedules(input: ScheduleEngineInput, maxCollateralChanges = DEFAULT_MAX_COLLATERAL_CHANGES): PredictionOutcome {
  validateInput(input)
  if (!Number.isInteger(maxCollateralChanges) || maxCollateralChanges < 0 || maxCollateralChanges > MAX_CONFIGURED_COLLATERAL_CHANGES) {
    throw new Error(`Maximum collateral changes must be an integer from 0 through ${MAX_CONFIGURED_COLLATERAL_CHANGES}.`)
  }

  const targetBuild = buildTargetGroups(input)
  if (targetBuild.error) return { results: [], no_valid_schedule_reason: targetBuild.error }
  const targets = targetBuild.groups
  const current = buildCurrentGroups(input)
  const targetChoices = enumerateTargetChoices(targets)
  const queue = new PriorityQueue<SearchState>((left, right) => compareStates(left, right, targets, current))
  const visited = new Set<string>()
  const deadEnds = new Set<string>()
  const solutions: RankedSolution[] = []
  const solutionKeys = new Set<string>()
  let reachedDepthLimit = false
  let examinedStates = 0

  const addSolution = (state: SearchState) => {
    const schedule = scheduleFor(state, input, targets, current)
    const key = scheduleSignature(schedule)
    if (solutionKeys.has(key)) return
    solutionKeys.add(key)
    solutions.push({
      state,
      collateralCount: collateralCount(state),
      popularity: statePopularity(state, targets, current),
      scheduleKey: key,
    })
  }
  const enqueue = (state: SearchState) => {
    const key = stateKey(state)
    if (visited.has(key)) return
    visited.add(key)
    queue.push(state)
  }
  const expand = (state: SearchState, issue: ScheduleIssue) => {
    const branched = branchState(state, issue, current, maxCollateralChanges)
    reachedDepthLimit ||= branched.reachedDepthLimit
    if (branched.states.length === 0) deadEnds.add(deadEndReason(issue, current))
    branched.states.forEach(enqueue)
  }

  const directSolutions: SearchState[] = []
  for (const choice of targetChoices) {
    const state = { targetChoices: choice, currentChoices: current.map(() => 0) }
    visited.add(stateKey(state))
    const issue = firstScheduleIssue(state, targets, current)
    if (issue) expand(state, issue)
    else directSolutions.push(state)
  }
  directSolutions.sort((left, right) => compareStates(left, right, targets, current))
  directSolutions.forEach(addSolution)

  while (queue.length > 0 && solutions.length < MAX_RESULTS && examinedStates < MAX_SEARCH_STATES) {
    const state = queue.shift()!
    examinedStates += 1
    const issue = firstScheduleIssue(state, targets, current)
    if (issue) expand(state, issue)
    else addSolution(state)
  }

  solutions.sort((left, right) => left.collateralCount - right.collateralCount || right.popularity - left.popularity || left.scheduleKey.localeCompare(right.scheduleKey))
  if (solutions.length > 0) {
    return {
      results: solutions.slice(0, MAX_RESULTS).map((solution) => resultFor(solution, input, targets, current)),
      no_valid_schedule_reason: null,
    }
  }

  const details = [...deadEnds].slice(0, 2).join(' ')
  const depth = reachedDepthLimit
    ? ` Resolving the remaining conflicts would require more than the configured limit of ${maxCollateralChanges} unrelated course change${maxCollateralChanges === 1 ? '' : 's'}.`
    : ''
  const searchLimit = examinedStates >= MAX_SEARCH_STATES ? ' The search safety limit was reached before a valid arrangement was found.' : ''
  return {
    results: [],
    no_valid_schedule_reason: `No valid schedule was found using the existing sections and meeting patterns.${details ? ` ${details}` : ''}${depth}${searchLimit}`,
  }
}

export function maxCollateralChangesFromEnvironment(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_MAX_COLLATERAL_CHANGES
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_CONFIGURED_COLLATERAL_CHANGES) {
    throw new Error(`SCHEDULE_ENGINE_MAX_COLLATERAL_CHANGES must be an integer from 0 through ${MAX_CONFIGURED_COLLATERAL_CHANGES}.`)
  }
  return parsed
}

export function createPredictionFunction(options: { maxCollateralChanges?: number } = {}): PredictionFunction {
  const maxCollateralChanges = options.maxCollateralChanges ?? DEFAULT_MAX_COLLATERAL_CHANGES
  return async (input) => predictSchedules(input, maxCollateralChanges)
}
