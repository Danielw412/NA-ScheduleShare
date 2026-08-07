import type { CourseNameSearchResult, DayType, ScheduleEnrollment, SemesterTerm } from './domain'

export interface ScheduleCoverageIssue {
  term: SemesterTerm
  day: DayType
  period: number
  count: number
}

const SEMESTERS: SemesterTerm[] = ['semester_1', 'semester_2']
const DAYS: DayType[] = ['A', 'B']
const PERIODS = Array.from({ length: 9 }, (_, index) => index + 1)

function meetingSlots(enrollment: ScheduleEnrollment) {
  return enrollment.meeting_slots ?? enrollment.class.meeting_slots
}

export function isStudyHallCourseName(courseName: string): boolean {
  return /^study hall\b/i.test(courseName.trim())
}

/** One unit equals 0.5 credits. */
export function enrollmentCreditUnits(enrollment: ScheduleEnrollment): number {
  const slots = meetingSlots(enrollment)
  if (slots.length === 0) return 0
  if (enrollment.academic_term !== 'full_year') return 1
  if (enrollment.class.is_double_period) return 3
  return new Set(slots.map((slot) => slot.day_type)).size === 1 ? 1 : 2
}

export function formatCreditUnits(units: number): string {
  const credits = units / 2
  return Number.isInteger(credits) ? credits.toFixed(1) : String(credits)
}

export function scheduleCoverageIssues(enrollments: ScheduleEnrollment[]): ScheduleCoverageIssue[] {
  const counts = new Map<string, number>()
  for (const enrollment of enrollments.filter((item) => item.active)) {
    const terms: SemesterTerm[] = enrollment.academic_term === 'full_year'
      ? SEMESTERS
      : [enrollment.academic_term]
    for (const term of terms) {
      for (const slot of meetingSlots(enrollment)) {
        const key = `${term}:${slot.day_type}:${slot.period_number}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }

  const issues: ScheduleCoverageIssue[] = []
  for (const term of SEMESTERS) {
    for (const day of DAYS) {
      for (const period of PERIODS) {
        const count = counts.get(`${term}:${day}:${period}`) ?? 0
        if (count !== 1) issues.push({ term, day, period, count })
      }
    }
  }
  return issues
}

export function scheduleCoverageIssueLabel(issue: ScheduleCoverageIssue): string {
  const semester = issue.term === 'semester_1' ? 'S1' : 'S2'
  return `${semester} ${issue.day}${issue.period}`
}

function possibleReplacementUnits(course: CourseNameSearchResult, studyHallCount: number): number[] {
  if (isStudyHallCourseName(course.course_name)) return studyHallCount === 1 ? [1, 2] : [1]
  switch (course.course_term_policy ?? 'full_year') {
    case 'semester':
    case 'flexible_attendance':
    case 'sectioned_attendance':
      return [1]
    case 'lunch':
      return [1, 2]
    case 'full_year':
      return [2, 3]
    case 'variable_credit':
    case 'versioned':
      return [1, 2, 3]
  }
}

export function possibleReplacementCreditTotals(courses: CourseNameSearchResult[]): Set<number> {
  if (courses.length === 0) return new Set()
  const studyHallCount = courses.filter((course) => isStudyHallCourseName(course.course_name)).length
  let totals = new Set([0])
  for (const course of courses) {
    const next = new Set<number>()
    for (const total of totals) {
      for (const units of possibleReplacementUnits(course, studyHallCount)) next.add(total + units)
    }
    totals = next
  }
  return totals
}

export function replacementCreditsCanMatch(courses: CourseNameSearchResult[], sourceCreditUnits: number): boolean {
  return possibleReplacementCreditTotals(courses).has(sourceCreditUnits)
}
