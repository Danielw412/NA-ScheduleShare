import { AlertCircle, CalendarDays, Check, CheckCircle2, Circle, Plus, RefreshCw, Search, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { meetingSlotFacts, periodsLabel } from '../components/schedule/periodLabels'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { Dialog } from '../components/ui/Dialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { useToast } from '../components/ui/Toast'
import { changedEnrollmentIds, changedPeriods, scheduleChanges, type ScheduleChange } from '../features/engine/scheduleChanges'
import { useCourseNameSearch } from '../hooks/useCourseNameSearch'
import { useSchedule } from '../hooks/useSchedule'
import type { AcademicTerm, CourseNameSearchResult, DayType, ScheduleEngineJob, ScheduleEngineJobStatus, ScheduleEnginePrediction, ScheduleEnrollment, SemesterTerm } from '../lib/domain'
import { enrollmentMeetingSlots, PERIOD_NUMBERS } from '../lib/schedule'
import {
  enrollmentCreditUnits,
  formatCreditUnits,
  isStudyHallCourseName,
  possibleReplacementCreditTotals,
  replacementCreditsCanMatch,
  scheduleCoverageIssues,
  type ScheduleCoverageIssue,
} from '../lib/scheduleEngineRules'
import { applyScheduleEnginePrediction, cancelScheduleEngineJob, createScheduleEngineJob, listScheduleEngineJobs } from '../lib/supabase/data'

const MAX_REPLACEMENTS = 3
const MAX_ACTIVE_REQUESTS = 5
const JOB_POLL_INTERVAL_MS = 15_000

const SEMESTERS: SemesterTerm[] = ['semester_1', 'semester_2']
const DAYS: DayType[] = ['A', 'B']

const termNames: Record<AcademicTerm, string> = {
  full_year: 'Full year',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
}

const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
const orList = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

interface ReplacementCourseDraft {
  key: string
  courseQuery: string
  replacementCourse: CourseNameSearchResult | null
}

type FormProblemKind = 'coverage' | 'selection' | 'rule' | 'credits'

interface FormProblem {
  kind: FormProblemKind
  message: string
}

function newReplacementCourse(): ReplacementCourseDraft {
  return { key: crypto.randomUUID(), courseQuery: '', replacementCourse: null }
}

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormatter.format(date)
}

function creditsLabel(units: number): string {
  return `${formatCreditUnits(units)} ${units === 2 ? 'credit' : 'credits'}`
}

function creditTotalsLabel(totals: Iterable<number>): string {
  const sorted = [...totals].sort((left, right) => left - right)
  const single = sorted.length === 1 && sorted[0] === 2
  return `${orList.format(sorted.map(formatCreditUnits))} ${single ? 'credit' : 'credits'}`
}

function isPlaceholderTeacher(teacher: string): boolean {
  return teacher.trim().toUpperCase() === 'N/A'
}

function coverageIssueText(issue: ScheduleCoverageIssue): string {
  return `${termNames[issue.term]}, ${issue.day} day period ${issue.period} ${issue.count === 0 ? 'is empty' : 'has more than one class'}`
}

function optionLabel(rank: number): string {
  return `Option ${rank}`
}

function predictionReason(prediction: ScheduleEnginePrediction): string {
  if (prediction.collateralChangeCount === 0) return 'Your requested courses fit without moving any unrelated courses.'
  if (prediction.collateralChangeCount === 1) return 'Your requested courses fit by moving one other course to an existing section.'
  return `Your requested courses fit by moving ${prediction.collateralChangeCount} other courses to existing sections.`
}

// The worker's generic failure text is written for whoever runs it ("after the
// worker is checked"), so students get their own wording for it.
const GENERIC_FAILURE_PATTERN = /^Schedule Engine processing failed\b/i
const FAILURE_GUIDANCE_PATTERN = /\b(try again|new request)\b/i

function failureCopy(errorMessage: string | null): { detail: string; guidance: boolean } {
  const message = errorMessage?.trim() ?? ''
  if (!message || GENERIC_FAILURE_PATTERN.test(message)) return { detail: 'Something went wrong while the engine was searching.', guidance: true }
  return { detail: message, guidance: !FAILURE_GUIDANCE_PATTERN.test(message) }
}

function collateralLabel(count: number): string {
  if (count === 0) return 'No unrelated courses moved'
  return count === 1 ? '1 other course moved' : `${count} other courses moved`
}

function periodsChangeLabel(periods: number[]): string {
  if (periods.length === 0) return 'Matches your current schedule'
  return `${periodsLabel(periods)} ${periods.length === 1 ? 'changes' : 'change'}`
}

function swapNames(job: ScheduleEngineJob) {
  return {
    from: andList.format(job.sourceCourses.map((course) => course.courseName)),
    to: andList.format(job.replacementCourses.map((course) => course.courseName)),
  }
}

function slotPeriods(enrollment: ScheduleEnrollment): number[] {
  return [...new Set(enrollmentMeetingSlots(enrollment).map((slot) => slot.period_number))].sort((left, right) => left - right)
}

/** "Carter, period 1, A and B days" — one short phrase per class. */
function enrollmentDescription(enrollment: ScheduleEnrollment): string {
  const parts: string[] = []
  if (!isPlaceholderTeacher(enrollment.class.teacher_last_name)) parts.push(enrollment.class.teacher_last_name)
  const facts = meetingSlotFacts(enrollmentMeetingSlots(enrollment))
  if (facts.length > 0) {
    const meeting = facts.join('; ')
    parts.push(parts.length > 0 ? meeting.replace(/^Period/, 'period') : meeting)
  }
  if (enrollment.academic_term !== 'full_year') parts.push(parts.length > 0 ? termNames[enrollment.academic_term].toLocaleLowerCase() : termNames[enrollment.academic_term])
  return parts.join(', ')
}

function sortByPeriod(enrollments: ScheduleEnrollment[]): ScheduleEnrollment[] {
  const termOrder: AcademicTerm[] = ['full_year', 'semester_1', 'semester_2']
  const firstSlot = (enrollment: ScheduleEnrollment) => [...enrollmentMeetingSlots(enrollment)].sort((left, right) => left.period_number - right.period_number || left.day_type.localeCompare(right.day_type))[0]
  return [...enrollments].sort((left, right) => {
    const leftSlot = firstSlot(left)
    const rightSlot = firstSlot(right)
    return (leftSlot?.period_number ?? 99) - (rightSlot?.period_number ?? 99)
      || (leftSlot?.day_type ?? '').localeCompare(rightSlot?.day_type ?? '')
      || termOrder.indexOf(left.academic_term) - termOrder.indexOf(right.academic_term)
      || left.class.course_name.localeCompare(right.class.course_name)
  })
}

function formProblemFor(sourceEnrollmentIds: string[], replacementCourses: ReplacementCourseDraft[], enrollments: ScheduleEnrollment[]): FormProblem | null {
  const coverageIssues = scheduleCoverageIssues(enrollments)
  if (coverageIssues.length > 0) return { kind: 'coverage', message: `Fill every period before using Schedule Engine. ${coverageIssueText(coverageIssues[0])}.` }
  if (sourceEnrollmentIds.length < 1 || sourceEnrollmentIds.length > MAX_REPLACEMENTS) return { kind: 'selection', message: 'Pick one to three courses to drop.' }
  if (replacementCourses.length < 1 || replacementCourses.length > MAX_REPLACEMENTS) return { kind: 'selection', message: 'Pick one to three courses to add.' }
  if (replacementCourses.some((draft) => !draft.replacementCourse)) return { kind: 'selection', message: 'Pick a catalog course in every search box, or remove the empty one.' }
  if (new Set(sourceEnrollmentIds).size !== sourceEnrollmentIds.length) return { kind: 'rule', message: 'Each current course can only be dropped once.' }

  const selectedReplacementCourses = replacementCourses.map((draft) => draft.replacementCourse!)
  const courseCounts = new Map<string, number>()
  for (const course of selectedReplacementCourses) courseCounts.set(course.id, (courseCounts.get(course.id) ?? 0) + 1)
  for (const [courseId, count] of courseCounts) {
    if (count < 2) continue
    const course = selectedReplacementCourses.find((item) => item.id === courseId)
    if (!course || !isStudyHallCourseName(course.course_name)) return { kind: 'rule', message: 'Only Study Hall can be added more than once. Remove the repeated course.' }
  }

  const courseIds = selectedReplacementCourses.map((course) => course.id)
  const selectedEnrollments: ScheduleEnrollment[] = []
  for (const enrollmentId of sourceEnrollmentIds) {
    const enrollment = enrollments.find((item) => item.id === enrollmentId)
    if (!enrollment) return { kind: 'rule', message: 'One of the courses you picked to drop is no longer in your schedule. Pick it again.' }
    selectedEnrollments.push(enrollment)
    if (courseIds.includes(enrollment.class.course_name_id)) return { kind: 'rule', message: 'A course can’t replace itself. Pick a different course to add.' }
  }

  const sourceCreditUnits = selectedEnrollments.reduce((total, enrollment) => total + enrollmentCreditUnits(enrollment), 0)
  if (!replacementCreditsCanMatch(selectedReplacementCourses, sourceCreditUnits)) {
    return { kind: 'credits', message: `The courses you add can’t make up the ${creditsLabel(sourceCreditUnits)} you’re dropping.` }
  }
  return null
}

/* ---------- Small presentational pieces ---------- */

function StatusBadge({ job }: { job: ScheduleEngineJob }) {
  switch (job.status) {
    case 'queued':
      return <span className="badge badge-outline">Waiting in line</span>
    case 'processing':
      return <span className="badge badge-info">Searching</span>
    case 'completed':
      return job.predictions.length > 0
        ? <span className="badge badge-success">{job.predictions.length === 1 ? '1 option' : `${job.predictions.length} options`}</span>
        : <span className="badge">No match yet</span>
    case 'cancelled':
      return <span className="badge badge-outline">Cancelled</span>
    case 'failed':
      return <span className="badge badge-danger">Failed</span>
  }
}

type CheckState = 'done' | 'problem' | 'pending'

interface CheckItem {
  id: string
  state: CheckState
  title: string
  detail?: ReactNode
  /** Read out by the summary's live region when this result changes. */
  announcement?: string
}

const checkStateText: Record<CheckState, string> = {
  done: 'Done: ',
  problem: 'Needs a fix: ',
  pending: 'Not yet: ',
}

function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <ul className="engine-checks">
      {items.map((item) => (
        <li className={`engine-check is-${item.state}`} key={item.id} data-check={item.id}>
          <span className="engine-check-icon" aria-hidden="true">
            {item.state === 'done' ? <CheckCircle2 /> : item.state === 'problem' ? <AlertCircle /> : <Circle />}
          </span>
          <div className="engine-check-text">
            <strong><span className="sr-only">{checkStateText[item.state]}</span>{item.title}</strong>
            {item.detail ? <div className="engine-check-detail">{item.detail}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function PeriodNumerals({ periods, className = '' }: { periods: number[]; className?: string }) {
  if (periods.length === 0) return null
  return (
    <span className={`engine-numerals ${className}`.trim()} aria-hidden="true">
      {periods.map((period) => <span className="period-numeral" key={period}>{period}</span>)}
    </span>
  )
}

function ChangeList({ changes, compact = false }: { changes: ScheduleChange[]; compact?: boolean }) {
  if (changes.length === 0) return <p className="engine-changes-empty">This option matches your current schedule.</p>
  return (
    <ul className={compact ? 'list engine-changes is-compact' : 'list engine-changes'}>
      {changes.map((change) => {
        const to = change.to
        const from = change.from
        const toTeacher = to && !isPlaceholderTeacher(to.class.teacher_last_name) ? to.class.teacher_last_name : null
        const fromTeacher = from && !isPlaceholderTeacher(from.class.teacher_last_name) ? from.class.teacher_last_name : null
        const sameCourse = Boolean(from && to && from.class.course_name_id === to.class.course_name_id)
        const replaces = !from
          ? 'Fills an empty period'
          : sameCourse
            ? `Same course, new section${fromTeacher ? ` (was ${fromTeacher})` : ''}`
            : `Replaces ${from.class.course_name}${fromTeacher ? ` (${fromTeacher})` : ''}`
        return (
          <li className="engine-change" key={change.key}>
            <PeriodNumerals periods={[...new Set(change.slots.map((slot) => slot.period_number))]} />
            <div className="engine-change-text">
              <p className="engine-change-to"><strong>{to ? to.class.course_name : 'No class'}</strong>{toTeacher ? <span>{toTeacher}</span> : null}</p>
              <p className="engine-change-from">{replaces}</p>
              {!compact ? (
                <div className="chip-list">
                  {meetingSlotFacts(change.slots).map((fact) => <span className="chip" key={fact}>{fact}</span>)}
                  {change.terms.length === 1 ? <span className="chip">{termNames[change.terms[0]]} only</span> : null}
                </div>
              ) : <p className="sr-only">{meetingSlotFacts(change.slots).join('; ')}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Catalog picker ---------- */

function CourseCatalogPicker({
  draft,
  index,
  total,
  excludedCourseIds,
  onChange,
  onRemove,
}: {
  draft: ReplacementCourseDraft
  index: number
  total: number
  excludedCourseIds: ReadonlySet<string>
  onChange: (next: Pick<ReplacementCourseDraft, 'courseQuery' | 'replacementCourse'>) => void
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useCourseNameSearch(draft.courseQuery)
  const results = search.results.filter((course) => !excludedCourseIds.has(course.id)).slice(0, 6)
  const inputId = `engine-add-${draft.key}`
  const listId = `${inputId}-results`
  const showResults = open && !search.loading && results.length > 0
  const activeOptionIndex = showResults && activeIndex >= 0 && activeIndex < results.length ? activeIndex : -1
  const activeOptionId = activeOptionIndex >= 0 ? `${listId}-${activeOptionIndex}` : undefined
  const query = draft.courseQuery.trim()
  const removeLabel = draft.replacementCourse ? `Remove ${draft.replacementCourse.course_name}` : `Remove course to add ${index + 1}`

  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionId])

  function close() {
    setOpen(false)
    setActiveIndex(-1)
  }

  function choose(course: CourseNameSearchResult) {
    onChange({ courseQuery: course.course_name, replacementCourse: course })
    close()
    // Keep the student in the search box, whatever they used to pick.
    inputRef.current?.focus()
  }

  // WAI-ARIA combobox: focus stays in the input and the arrow keys move the
  // highlighted result, announced through aria-activedescendant.
  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (search.loading || results.length === 0) return
      const last = results.length - 1
      const current = showResults ? activeOptionIndex : -1
      if (event.key === 'ArrowDown') setActiveIndex(current < 0 || current >= last ? 0 : current + 1)
      else setActiveIndex(current <= 0 ? last : current - 1)
      return
    }
    if (event.key === 'Enter' && activeOptionIndex >= 0) {
      // Pick the highlighted result instead of submitting the form.
      event.preventDefault()
      choose(results[activeOptionIndex])
    }
  }

  return (
    <div className="engine-add-row">
      <div
        className="field engine-picker"
        onFocusCapture={(event) => {
          // Returning to the input after picking a result should not reopen the list.
          if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="option"]')) return
          setOpen(true)
        }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close() } }}
      >
        <label htmlFor={inputId}>Course to add{total > 1 ? <span className="sr-only"> {index + 1}</span> : null}</label>
        <div className="engine-picker-control">
          <div className="engine-picker-input">
            <div className="search-input">
              <Search aria-hidden="true" />
              <input
                ref={inputRef}
                id={inputId}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showResults}
                aria-controls={showResults ? listId : undefined}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Search the course catalog"
                value={draft.courseQuery}
                onChange={(event) => { onChange({ courseQuery: event.target.value, replacementCourse: null }); setOpen(true); setActiveIndex(-1) }}
                onKeyDown={handleInputKeyDown}
              />
            </div>
            {showResults ? (
              <div className="engine-picker-results" id={listId} role="listbox" aria-label="Catalog courses">
                {results.map((course, resultIndex) => {
                  const selected = draft.replacementCourse?.id === course.id
                  const active = resultIndex === activeOptionIndex
                  return (
                    <button
                      aria-selected={selected}
                      className={['engine-picker-option', selected ? 'is-selected' : '', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                      id={`${listId}-${resultIndex}`}
                      key={course.id}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => choose(course)}
                    >
                      <span>{course.course_name}</span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          {onRemove ? <button className="icon-button engine-remove" type="button" aria-label={removeLabel} onClick={onRemove}><X aria-hidden="true" /></button> : null}
        </div>
        {open && search.loading ? <p className="field-help" role="status">Searching the catalog…</p> : null}
        {open && search.error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{search.error}</p> : null}
        {open && !search.loading && !search.error && query && results.length === 0 ? <p className="field-help">No catalog courses match “{query}”. Try a shorter name.</p> : null}
        {draft.replacementCourse
          ? <p className="field-help engine-picker-picked"><CheckCircle2 aria-hidden="true" /><span>Selected: <strong>{draft.replacementCourse.course_name}</strong></span></p>
          : !open && query ? <p className="field-help engine-picker-hint">Choose a course from the search results to use it.</p> : null}
      </div>
    </div>
  )
}

/* ---------- Schedule gate (incomplete schedule) ---------- */

function CoverageMap({ issues }: { issues: ScheduleCoverageIssue[] }) {
  const byKey = new Map(issues.map((issue) => [`${issue.term}:${issue.day}:${issue.period}`, issue]))
  const hasDoubles = issues.some((issue) => issue.count > 1)
  return (
    <div className="engine-coverage">
      {SEMESTERS.map((term) => (
        <div className="engine-coverage-term" key={term}>
          <h3>{termNames[term]}</h3>
          {DAYS.map((day) => {
            const dayIssues = issues.filter((issue) => issue.term === term && issue.day === day)
            const empty = dayIssues.filter((issue) => issue.count === 0).map((issue) => issue.period)
            const doubled = dayIssues.filter((issue) => issue.count > 1).map((issue) => issue.period)
            const summary = [
              empty.length > 0 ? `${periodsLabel(empty)} empty` : '',
              doubled.length > 0 ? `${periodsLabel(doubled)} with more than one class` : '',
            ].filter(Boolean).join('; ')
            return (
              <div className="engine-coverage-day" key={day}>
                <span className="engine-coverage-label">{day} day</span>
                <ol className="engine-coverage-periods" aria-hidden="true">
                  {PERIOD_NUMBERS.map((period) => {
                    const issue = byKey.get(`${term}:${day}:${period}`)
                    const state = !issue ? 'is-filled' : issue.count === 0 ? 'is-empty' : 'is-double'
                    return <li className={`engine-coverage-cell ${state}`} key={period}>{period}</li>
                  })}
                </ol>
                <span className="sr-only">{summary || 'All periods filled'}</span>
              </div>
            )
          })}
        </div>
      ))}
      <ul className="engine-coverage-legend" aria-hidden="true">
        <li><span className="engine-coverage-cell is-filled" />Has a class</li>
        <li><span className="engine-coverage-cell is-empty" />Empty</li>
        {hasDoubles ? <li><span className="engine-coverage-cell is-double" />More than one class</li> : null}
      </ul>
    </div>
  )
}

function ScheduleGate({ issues }: { issues: ScheduleCoverageIssue[] }) {
  const first = issues[0]
  const others = issues.length - 1
  return (
    <section className="engine-gate" aria-labelledby="engine-gate-title">
      <div className="engine-gate-text">
        <h2 id="engine-gate-title" tabIndex={-1}>Fill every period first</h2>
        <p>Schedule Engine needs exactly one class in every period, on A and B days, in both semesters. That’s how it knows what can move.</p>
        <p className="engine-gate-problem">
          <AlertCircle aria-hidden="true" />
          <span><strong>{coverageIssueText(first)}.</strong>{others > 0 ? ` ${others} other ${others === 1 ? 'period needs' : 'periods need'} a fix too.` : ''}</span>
        </p>
      </div>
      <CoverageMap issues={issues} />
      <div className="engine-gate-actions">
        <Link className="button button-primary" to="/schedule"><CalendarDays aria-hidden="true" />Open my schedule</Link>
      </div>
    </section>
  )
}

/* ---------- Request progress (queued / processing) ---------- */

function RequestProgress({ job, cancelling, error, onCancel }: { job: ScheduleEngineJob; cancelling: boolean; error: string | null; onCancel: () => void }) {
  const processing = job.status === 'processing'
  const steps: Array<{ label: string; detail: string; state: 'done' | 'now' | 'next' }> = [
    { label: 'Sent', detail: formatDateTime(job.queuedAt || job.createdAt), state: 'done' },
    { label: 'Waiting in line', detail: processing ? 'Picked up' : 'For the Schedule Engine computer', state: processing ? 'done' : 'now' },
    { label: 'Searching sections', detail: processing ? (job.processingStartedAt ? `Started ${formatDateTime(job.processingStartedAt)}` : 'Started') : 'Up to three schedules', state: processing ? 'now' : 'next' },
    { label: 'Options ready', detail: job.emailNotification ? 'We’ll email you' : 'Shown on this page', state: 'next' },
  ]
  return (
    <section className="engine-progress" aria-labelledby="engine-progress-title">
      <ol className="engine-steps">
        {steps.map((step, index) => (
          <li className={`engine-step is-${step.state}`} key={step.label} aria-current={step.state === 'now' ? 'step' : undefined}>
            <span className={step.state === 'now' ? 'period-numeral is-now' : step.state === 'done' ? 'period-numeral' : 'period-numeral is-muted'} aria-hidden="true">
              {step.state === 'done' ? <Check /> : index + 1}
            </span>
            <span className="engine-step-text">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="engine-progress-text" role="status" aria-live="polite">
        <h2 id="engine-progress-title">{processing ? 'The engine is working on your request' : 'Your request is in line'}</h2>
        <p>
          {processing
            ? 'It’s trying the sections other students have added to find schedules that fit. '
            : 'Requests run one at a time on the Schedule Engine computer, which isn’t always on, so it can take a few hours to reach yours. '}
          {job.emailNotification ? 'We’ll email you when your options are ready, so you can close this page.' : 'You can close this page and check back later. This page updates on its own.'}
        </p>
      </div>
      {job.status === 'queued' ? (
        <div className="engine-progress-actions">
          <button className="button button-secondary button-danger-outline" type="button" disabled={cancelling} onClick={onCancel}>
            <XCircle aria-hidden="true" />{cancelling ? 'Cancelling…' : 'Cancel request'}
          </button>
          {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        </div>
      ) : error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
    </section>
  )
}

/* ---------- Page ---------- */

export function ScheduleEnginePage() {
  const { enrollments, loading: scheduleLoading, error: scheduleError, reload: reloadSchedule } = useSchedule()
  const { showToast } = useToast()
  const optionGroupName = useId()
  const [sourceEnrollmentIds, setSourceEnrollmentIds] = useState<string[]>([])
  const [replacementCourses, setReplacementCourses] = useState<ReplacementCourseDraft[]>(() => [newReplacementCourse()])
  const [emailNotification, setEmailNotification] = useState(true)
  const [jobs, setJobs] = useState<ScheduleEngineJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobLoading, setJobLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [selectedTerm, setSelectedTerm] = useState<SemesterTerm>('semester_1')
  const [selectedPredictionRank, setSelectedPredictionRank] = useState(1)
  const [mobileDay, setMobileDay] = useState<DayType>('A')
  const [applyingPredictionKey, setApplyingPredictionKey] = useState<string | null>(null)
  const [appliedPrediction, setAppliedPrediction] = useState<{ key: string; jobId: string; rank: number; before: ScheduleEnrollment[] } | null>(null)
  const [confirmingApply, setConfirmingApply] = useState(false)
  const [confirmingCancelJobId, setConfirmingCancelJobId] = useState<string | null>(null)

  const jobStatuses = useRef(new Map<string, ScheduleEngineJobStatus>())
  const requestTitleRef = useRef<HTMLHeadingElement>(null)
  const optionTitleRef = useRef<HTMLHeadingElement>(null)

  // Most actions here swap one view for another and unmount the control that
  // was used, so each one names where focus should land once React renders.
  // A request is tried on the next render only, so it can never fire late.
  const pendingFocus = useRef<{ ids: string[]; scrollToId?: string } | null>(null)
  const [, setFocusRequests] = useState(0)
  const focusAfterRender = useCallback((ids: string[], scrollToId?: string) => {
    pendingFocus.current = { ids, scrollToId }
    setFocusRequests((count) => count + 1)
  }, [])

  useEffect(() => {
    const request = pendingFocus.current
    if (!request) return
    pendingFocus.current = null
    const target = request.ids.map((id) => document.getElementById(id)).find((element) => element !== null)
    if (!target) return
    const scrollTarget = request.scrollToId ? document.getElementById(request.scrollToId) : null
    scrollTarget?.scrollIntoView?.({ block: 'start' })
    target.focus({ preventScroll: Boolean(scrollTarget) })
  })

  const refreshJobs = useCallback(async (preferredJobId?: string) => {
    try {
      const nextJobs = await listScheduleEngineJobs()
      // The page polls while a request waits, so say so when one finishes.
      const finished = nextJobs.filter((job) => {
        const before = jobStatuses.current.get(job.id)
        return (before === 'queued' || before === 'processing') && (job.status === 'completed' || job.status === 'failed')
      })
      jobStatuses.current = new Map(nextJobs.map((job) => [job.id, job.status]))
      if (finished.some((job) => job.status === 'completed')) showToast('Your Schedule Engine results are ready.')
      else if (finished.length > 0) showToast('A Schedule Engine request didn’t finish.', 'error')
      setJobs(nextJobs)
      setSelectedJobId((current) => preferredJobId ?? (current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id ?? null))
    } finally {
      setJobLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refreshJobs().catch(() => setJobLoading(false))
  }, [refreshJobs])

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'queued' || job.status === 'processing')) return
    const timer = window.setInterval(() => { void refreshJobs().catch(() => undefined) }, JOB_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [jobs, refreshJobs])

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const selectedPrediction = selectedJob?.predictions.find((prediction) => prediction.rank === selectedPredictionRank) ?? selectedJob?.predictions[0] ?? null
  const selectedPredictionKey = selectedJob && selectedPrediction ? `${selectedJob.id}:${selectedPrediction.rank}` : null
  const activeRequestCount = jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length
  const atRequestLimit = activeRequestCount >= MAX_ACTIVE_REQUESTS
  const coverageIssues = useMemo(() => scheduleCoverageIssues(enrollments), [enrollments])
  const formProblem = useMemo(() => formProblemFor(sourceEnrollmentIds, replacementCourses, enrollments), [sourceEnrollmentIds, replacementCourses, enrollments])
  const sortedEnrollments = useMemo(() => sortByPeriod(enrollments), [enrollments])
  const selectedCurrentCourseIds = useMemo(() => new Set(sourceEnrollmentIds.flatMap((id) => {
    const enrollment = enrollments.find((item) => item.id === id)
    return enrollment ? [enrollment.class.course_name_id] : []
  })), [sourceEnrollmentIds, enrollments])
  const selectedReplacementCourseIds = useMemo(() => new Set(replacementCourses.flatMap((draft) => {
    const course = draft.replacementCourse
    return course && !isStudyHallCourseName(course.course_name) ? [course.id] : []
  })), [replacementCourses])
  const selectedSourceEnrollments = useMemo(() => sourceEnrollmentIds.flatMap((id) => {
    const enrollment = enrollments.find((item) => item.id === id)
    return enrollment ? [enrollment] : []
  }), [sourceEnrollmentIds, enrollments])
  const selectedSourceCreditUnits = useMemo(
    () => selectedSourceEnrollments.reduce((total, enrollment) => total + enrollmentCreditUnits(enrollment), 0),
    [selectedSourceEnrollments],
  )
  const selectedReplacementCourses = replacementCourses.flatMap((draft) => draft.replacementCourse ? [draft.replacementCourse] : [])
  const replacementSelectionsComplete = selectedReplacementCourses.length === replacementCourses.length
  const creditMatchPossible = selectedSourceEnrollments.length > 0
    && selectedSourceEnrollments.length === sourceEnrollmentIds.length
    && selectedReplacementCourses.length > 0
    && replacementSelectionsComplete
    && replacementCreditsCanMatch(selectedReplacementCourses, selectedSourceCreditUnits)
  const singleStudyHallSelection = selectedReplacementCourses.filter((course) => isStudyHallCourseName(course.course_name)).length === 1

  // Diff each option against the schedule it would replace. The option that
  // was applied keeps the schedule it replaced (the live one already matches
  // it); every other option compares with the live schedule. Those others
  // can't be applied anymore: the server rejects options from a request once
  // the schedule has changed since it was sent.
  const scheduleReady = !scheduleLoading && !scheduleError
  const appliedFromSelectedJob = appliedPrediction && selectedJob && appliedPrediction.jobId === selectedJob.id ? appliedPrediction : null
  const predictionChanges = useMemo(() => {
    if (!scheduleReady || !selectedJob) return null
    return new Map(selectedJob.predictions.map((prediction) => {
      const baseline = appliedFromSelectedJob?.rank === prediction.rank ? appliedFromSelectedJob.before : enrollments
      return [prediction.rank, baseline.length > 0 ? scheduleChanges(baseline, prediction.schedule) : null]
    }))
  }, [appliedFromSelectedJob, enrollments, scheduleReady, selectedJob])
  const selectedOptionOutdated = Boolean(selectedPrediction && appliedFromSelectedJob && appliedFromSelectedJob.rank !== selectedPrediction.rank)
  const selectedChanges = selectedPrediction ? predictionChanges?.get(selectedPrediction.rank) ?? null : null
  const gridChangedIds = useMemo(() => {
    if (!selectedPrediction) return new Set<string>()
    const ids = new Set(selectedPrediction.schedule.filter((enrollment) => enrollment.changedFromEnrollmentId).map((enrollment) => enrollment.id))
    if (selectedChanges) for (const id of changedEnrollmentIds(selectedChanges)) ids.add(id)
    return ids
  }, [selectedChanges, selectedPrediction])

  function updateReplacementCourse(key: string, update: Partial<ReplacementCourseDraft>) {
    setReplacementCourses((current) => current.map((draft) => draft.key === key ? { ...draft, ...update } : draft))
    setSubmitError(null)
  }

  function toggleSourceEnrollment(enrollmentId: string) {
    setSourceEnrollmentIds((current) => current.includes(enrollmentId)
      ? current.filter((id) => id !== enrollmentId)
      : current.length >= MAX_REPLACEMENTS ? current : [...current, enrollmentId])
    setSubmitError(null)
  }

  function selectJob(jobId: string) {
    setCreatingNew(false)
    setSelectedJobId(jobId)
    setSelectedPredictionRank(1)
    setSubmitError(null)
    // The request opens above the list, often off screen on a phone.
    focusAfterRender(['engine-request-title'], 'engine-request')
  }

  function resetForm() {
    if (atRequestLimit) return
    setSourceEnrollmentIds([])
    setReplacementCourses([newReplacementCourse()])
    setEmailNotification(true)
    setSubmitError(null)
    setCreatingNew(true)
    focusAfterRender(['engine-drop-title', 'engine-gate-title', 'engine-new-request'])
  }

  function closeForm() {
    setCreatingNew(false)
    setSubmitError(null)
    focusAfterRender(['engine-request-title'])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (formProblem) {
      setSubmitError(formProblem.message)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const jobId = await createScheduleEngineJob({
        enrollmentIds: sourceEnrollmentIds,
        replacementCourseIds: replacementCourses.map((draft) => draft.replacementCourse!.id),
      }, emailNotification)
      setCreatingNew(false)
      setSelectedPredictionRank(1)
      await refreshJobs(jobId)
      focusAfterRender(['engine-request-title'])
      showToast('Request sent. It’s waiting in line.')
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'The request could not be sent. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelJob(jobId: string) {
    setCancellingJobId(jobId)
    setSubmitError(null)
    try {
      await cancelScheduleEngineJob(jobId)
      await refreshJobs(jobId)
      showToast('Request cancelled.')
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'The request could not be cancelled.')
    } finally {
      setCancellingJobId(null)
    }
  }

  async function applyPrediction(job: ScheduleEngineJob, prediction: ScheduleEnginePrediction) {
    const predictionKey = `${job.id}:${prediction.rank}`
    const before = enrollments
    setApplyingPredictionKey(predictionKey)
    setSubmitError(null)
    try {
      await applyScheduleEnginePrediction(job.id, prediction.rank)
      await reloadSchedule()
      setAppliedPrediction({ key: predictionKey, jobId: job.id, rank: prediction.rank, before })
      focusAfterRender(['engine-apply-success'])
      showToast(`Your schedule now matches ${optionLabel(prediction.rank).toLowerCase()}.`)
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Your schedule could not be updated.')
    } finally {
      setApplyingPredictionKey(null)
    }
  }

  const showForm = creatingNew || (!jobLoading && jobs.length === 0)
  const showHistory = !jobLoading && (jobs.length > 1 || (showForm && jobs.length > 0))
  const confirmingCancelJob = jobs.find((job) => job.id === confirmingCancelJobId) ?? null
  const selectedSwap = selectedJob ? swapNames(selectedJob) : null
  const selectedFailure = selectedJob?.status === 'failed' ? failureCopy(selectedJob.errorMessage) : null
  const checkItems = formChecks({
    sourceEnrollments: selectedSourceEnrollments,
    replacementCourses: selectedReplacementCourses,
    replacementSelectionsComplete,
    sourceCreditUnits: selectedSourceCreditUnits,
    creditMatchPossible,
    singleStudyHallSelection,
    problem: formProblem,
  })
  // Only results that can change while the student edits are announced.
  const checkAnnouncement = checkItems.flatMap((item) => item.announcement ? [item.announcement] : []).join(' ')

  return (
    <div className="page engine-page">
      <PageHeader
        title="Schedule Engine"
        description="Swap up to three courses and see the schedules that could work. It only uses sections other students have added, so it gets more accurate as more people join. Invite your friends!"
        actions={!jobLoading && jobs.length > 0 && !showForm
          ? <button className="button button-secondary" type="button" disabled={atRequestLimit} onClick={resetForm}><Plus aria-hidden="true" />New request</button>
          : null}
      />

      {jobLoading ? (
        <div className="engine-loading" role="status" aria-label="Loading your requests">
          <span className="skeleton engine-loading-title" />
          <span className="skeleton engine-loading-block" />
        </div>
      ) : null}

      {!showForm && selectedJob ? (
        <div className="engine-job">
          {atRequestLimit ? (
            <p className="notice notice-info engine-limit">
              <AlertCircle aria-hidden="true" />
              <span>You have five requests in progress, the most allowed at once. Cancel one that’s waiting in line, or wait for results, to start another.</span>
            </p>
          ) : null}

          <section className="engine-request" id="engine-request" aria-labelledby="engine-request-title">
            <div className="engine-request-meta" id="engine-request-meta">
              <StatusBadge job={selectedJob} />
              <span>Sent {formatDateTime(selectedJob.createdAt)}</span>
              <span>Email notification {selectedJob.emailNotification ? 'on' : 'off'}</span>
            </div>
            <h2 className="engine-request-title" id="engine-request-title" ref={requestTitleRef} tabIndex={-1} aria-describedby="engine-request-meta">
              <span className="engine-request-verb">Swap</span>{' '}{selectedSwap?.from}{' '}
              <span className="engine-request-verb">for</span>{' '}{selectedSwap?.to}
            </h2>
          </section>

          {selectedJob.status === 'queued' || selectedJob.status === 'processing' ? (
            <RequestProgress
              job={selectedJob}
              cancelling={cancellingJobId === selectedJob.id}
              error={submitError}
              onCancel={() => setConfirmingCancelJobId(selectedJob.id)}
            />
          ) : null}

          {selectedJob.status === 'cancelled' ? (
            <div className="engine-outcome">
              <p className="notice engine-outcome-notice"><XCircle aria-hidden="true" /><span>You cancelled this request before it ran.</span></p>
              <button className="button button-primary" type="button" disabled={atRequestLimit} onClick={resetForm}><Plus aria-hidden="true" />Start a new request</button>
            </div>
          ) : null}

          {selectedJob.status === 'failed' ? (
            <div className="engine-outcome">
              <div className="notice notice-danger engine-outcome-notice" role="alert">
                <AlertCircle aria-hidden="true" />
                <div className="engine-outcome-text">
                  <p><strong>This request didn’t finish.</strong></p>
                  <p>{selectedFailure?.detail}</p>
                  {selectedFailure?.guidance ? <p>Start a new request to try again.</p> : null}
                </div>
              </div>
              <button className="button button-primary" type="button" disabled={atRequestLimit} onClick={resetForm}><RefreshCw aria-hidden="true" />Start a new request</button>
            </div>
          ) : null}

          {selectedJob.status === 'completed' && !selectedPrediction ? (
            <section className="engine-no-result" aria-labelledby="engine-no-result-title" role="status">
              <h2 id="engine-no-result-title">No valid schedule yet</h2>
              <p>Schedule Engine only uses sections students have already added, and none of them fit this swap yet. Try again in a couple of hours as more students join, or ask your friends to add their schedules. Schedule Engine gets more accurate over time.</p>
              {selectedJob.noValidScheduleReason ? (
                <div className="engine-no-result-reason">
                  <h3>What blocked this request</h3>
                  <p>{selectedJob.noValidScheduleReason}</p>
                </div>
              ) : null}
              <button className="button button-primary" type="button" disabled={atRequestLimit} onClick={resetForm}><Plus aria-hidden="true" />Try a different swap</button>
            </section>
          ) : null}

          {selectedJob.status === 'completed' && selectedPrediction ? (
            <section className="engine-results" aria-labelledby="engine-results-title">
              <div className="engine-results-head">
                <h2 id="engine-results-title">{selectedJob.predictions.length === 1 ? 'One schedule works' : `${selectedJob.predictions.length} schedules work`}</h2>
                <p>Ranked so the fewest other classes move. Options are estimates built from sections other students have added.</p>
              </div>

              <div className="engine-options" role="radiogroup" aria-label="Schedule options">
                {selectedJob.predictions.map((prediction) => {
                  const selected = prediction.rank === selectedPrediction.rank
                  const changes = predictionChanges?.get(prediction.rank) ?? null
                  const periods = changes ? changedPeriods(changes) : []
                  const summaryId = `${optionGroupName}-summary-${prediction.rank}`
                  return (
                    <label className={selected ? 'engine-option is-selected' : 'engine-option'} key={prediction.rank}>
                      <input
                        type="radio"
                        name={optionGroupName}
                        checked={selected}
                        aria-label={prediction.rank === 1 ? `${optionLabel(prediction.rank)}, most likely` : optionLabel(prediction.rank)}
                        aria-describedby={summaryId}
                        onChange={() => { setSelectedPredictionRank(prediction.rank); setSubmitError(null) }}
                      />
                      <span className="engine-option-head">
                        <span className="engine-option-title">{optionLabel(prediction.rank)}</span>
                        {prediction.rank === 1 ? <span className="badge">Most likely</span> : null}
                        {prediction.developmentPlaceholder ? <span className="badge badge-outline">Placeholder</span> : null}
                      </span>
                      <PeriodNumerals periods={periods} className="engine-option-numerals" />
                      <span className="engine-option-summary" id={summaryId}>
                        {changes ? <><span>{periodsChangeLabel(periods)}.</span>{' '}</> : null}
                        <span>{collateralLabel(prediction.collateralChangeCount)}</span>
                      </span>
                    </label>
                  )
                })}
              </div>

              <div className="engine-option-detail">
                <div className="engine-option-info">
                  <div className="engine-option-info-head">
                    <h3 id="engine-option-title" ref={optionTitleRef} tabIndex={-1}>{optionLabel(selectedPrediction.rank)}</h3>
                    <p>{predictionReason(selectedPrediction)}</p>
                  </div>

                  <div className="engine-apply">
                    {appliedPrediction?.key === selectedPredictionKey ? (
                      <div className="notice notice-success engine-apply-success" id="engine-apply-success" tabIndex={-1}>
                        <CheckCircle2 aria-hidden="true" />
                        <p>This option is now your schedule. <Link className="inline-link" to="/schedule">Open my schedule</Link></p>
                      </div>
                    ) : selectedOptionOutdated && appliedFromSelectedJob ? (
                      <>
                        <div className="notice notice-info engine-apply-outdated">
                          <AlertCircle aria-hidden="true" />
                          <p>{optionLabel(appliedFromSelectedJob.rank)} is now your schedule, so this option can’t be applied. Start a new request to get options built from your current schedule.</p>
                        </div>
                        <button className="button button-secondary" type="button" disabled={atRequestLimit} onClick={resetForm}><Plus aria-hidden="true" />Start a new request</button>
                      </>
                    ) : (
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={applyingPredictionKey === selectedPredictionKey || selectedPrediction.developmentPlaceholder}
                        onClick={() => setConfirmingApply(true)}
                      >
                        <CheckCircle2 aria-hidden="true" />
                        {applyingPredictionKey === selectedPredictionKey ? 'Updating your schedule…' : 'Make this my schedule'}
                      </button>
                    )}
                    {selectedPrediction.developmentPlaceholder && !selectedOptionOutdated ? <p className="field-help">This is a development placeholder, so it can’t be applied.</p> : null}
                    {submitError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{submitError}</p> : null}
                  </div>

                  <section className="engine-option-changes" aria-labelledby="engine-changes-title">
                    <h4 className="engine-subhead" id="engine-changes-title">{appliedPrediction?.key === selectedPredictionKey ? 'What changed' : 'What changes'}</h4>
                    {selectedChanges
                      ? <ChangeList changes={selectedChanges} />
                      : <p className="engine-changes-empty">Changed classes are marked in the schedule.</p>}
                  </section>

                  {selectedPrediction.explanations.length > 0 ? (
                    <details className="engine-notes">
                      <summary>How the engine got here</summary>
                      <ul>{selectedPrediction.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}</ul>
                    </details>
                  ) : null}
                </div>

                <section className="engine-option-schedule" aria-labelledby="engine-schedule-title">
                  <div className="engine-option-schedule-head">
                    <h4 className="engine-subhead" id="engine-schedule-title">Full schedule</h4>
                    <TermSelector value={selectedTerm} onChange={setSelectedTerm} label="Semester shown" />
                  </div>
                  <ScheduleGrid
                    enrollments={selectedPrediction.schedule}
                    selectedTerm={selectedTerm}
                    changedEnrollmentIds={gridChangedIds}
                    mobileDay={mobileDay}
                    onMobileDayChange={setMobileDay}
                    readOnly
                    onAdd={() => undefined}
                    onRemove={() => undefined}
                    onReplace={() => undefined}
                  />
                </section>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <div className="engine-new" id="engine-new-request" tabIndex={-1}>
          {scheduleLoading ? (
            <div className="engine-loading" role="status" aria-label="Loading your current schedule">
              <span className="skeleton engine-loading-title" />
              <span className="skeleton engine-loading-block" />
            </div>
          ) : scheduleError ? (
            <div className="notice notice-danger" role="alert">
              <AlertCircle aria-hidden="true" />
              <div><strong>Your schedule didn’t load.</strong> {scheduleError}</div>
              <button className="button button-secondary button-sm" type="button" onClick={() => void reloadSchedule()}><RefreshCw aria-hidden="true" />Try again</button>
            </div>
          ) : enrollments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Add your classes first"
              action={<Link className="button button-primary" to="/schedule"><CalendarDays aria-hidden="true" />Open my schedule</Link>}
            >
              Schedule Engine needs your full schedule to find swaps that work.
            </EmptyState>
          ) : coverageIssues.length > 0 ? (
            <ScheduleGate issues={coverageIssues} />
          ) : (
            <form className="engine-form" onSubmit={(event) => void submit(event)} aria-label="New Schedule Engine request">
              <div className="engine-form-fields">
                <section className="engine-form-section" aria-labelledby="engine-drop-title">
                  <div className="engine-form-section-head">
                    <h2 id="engine-drop-title" tabIndex={-1}>Courses to drop</h2>
                    <p>Pick up to three classes from your schedule.</p>
                  </div>
                  <div role="group" aria-labelledby="engine-drop-title">
                  <ul className="engine-drop-list">
                    {sortedEnrollments.map((enrollment) => {
                      const checked = sourceEnrollmentIds.includes(enrollment.id)
                      const disabled = !checked && sourceEnrollmentIds.length >= MAX_REPLACEMENTS
                      const periods = slotPeriods(enrollment)
                      return (
                        <li key={enrollment.id}>
                          <label className={['engine-drop-row', checked ? 'is-checked' : '', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
                            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleSourceEnrollment(enrollment.id)} />
                            <PeriodNumerals periods={periods.slice(0, 1)} />
                            <span className="engine-drop-text">
                              <strong>{enrollment.class.course_name}</strong>
                              <span>{enrollmentDescription(enrollment)}</span>
                            </span>
                            <span className="engine-drop-credit">{creditsLabel(enrollmentCreditUnits(enrollment))}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  </div>
                  {sourceEnrollmentIds.length >= MAX_REPLACEMENTS ? <p className="field-help">You can drop up to three courses. Uncheck one to pick another.</p> : null}
                </section>

                <section className="engine-form-section" aria-labelledby="engine-add-title">
                  <div className="engine-form-section-head">
                    <h2 id="engine-add-title">Courses to add</h2>
                    <p>Search the course catalog. You can add up to three.</p>
                  </div>
                  <div className="engine-add-list">
                    {replacementCourses.map((draft, index) => {
                      const excludedCourses = new Set([...selectedReplacementCourseIds, ...selectedCurrentCourseIds])
                      if (draft.replacementCourse && !isStudyHallCourseName(draft.replacementCourse.course_name)) excludedCourses.delete(draft.replacementCourse.id)
                      return (
                        <CourseCatalogPicker
                          key={draft.key}
                          draft={draft}
                          index={index}
                          total={replacementCourses.length}
                          excludedCourseIds={excludedCourses}
                          onChange={(update) => updateReplacementCourse(draft.key, update)}
                          onRemove={replacementCourses.length > 1 ? () => { setReplacementCourses((current) => current.filter((item) => item.key !== draft.key)); setSubmitError(null) } : undefined}
                        />
                      )
                    })}
                  </div>
                  {replacementCourses.length < MAX_REPLACEMENTS ? (
                    <button className="button button-ghost engine-add-another" type="button" onClick={() => setReplacementCourses((current) => [...current, newReplacementCourse()])}>
                      <Plus aria-hidden="true" />Add another course
                    </button>
                  ) : null}
                </section>
              </div>

              <aside className="engine-summary" aria-labelledby="engine-summary-title">
                <h2 id="engine-summary-title">Before you search</h2>
                <Checklist items={checkItems} />
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{checkAnnouncement}</p>
                <label className="checkbox-row engine-email">
                  <input type="checkbox" checked={emailNotification} onChange={(event) => setEmailNotification(event.target.checked)} />
                  <span><strong>Email me when my options are ready</strong><small>One email, sent when the search finishes.</small></span>
                </label>
                {submitError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{submitError}</p> : null}
                <div className="engine-summary-actions">
                  <button className="button button-primary button-block" disabled={submitting || scheduleLoading || enrollments.length === 0 || Boolean(formProblem)} type="submit">
                    {submitting ? 'Sending request…' : 'Find schedules'}
                  </button>
                  {creatingNew ? <button className="button button-ghost button-block" type="button" onClick={closeForm}>Cancel</button> : null}
                </div>
                <p className="engine-summary-note">Requests run one at a time on the Schedule Engine computer, which isn’t always on, so results can take a few hours. You can leave this page after you send it.</p>
              </aside>
            </form>
          )}
        </div>
      ) : null}

      {showHistory ? (
        <section className="section engine-history" aria-labelledby="engine-history-title">
          <div className="section-header">
            <h2 id="engine-history-title">Your requests</h2>
            <span className="section-count">{jobs.length}</span>
          </div>
          <ul className="list engine-history-list">
            {jobs.map((job) => {
              const current = !showForm && job.id === selectedJob?.id
              const names = swapNames(job)
              return (
                <li key={job.id}>
                  <button className={current ? 'engine-history-row is-current' : 'engine-history-row'} type="button" aria-current={current ? 'true' : undefined} onClick={() => selectJob(job.id)}>
                    <span className="engine-history-text">
                      <strong>Swap {names.from} for {names.to}</strong>
                      <span>Sent {formatDateTime(job.createdAt)}</span>
                    </span>
                    <StatusBadge job={job} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {confirmingApply && selectedJob && selectedPrediction ? (
        <Dialog
          role="alertdialog"
          title={`Make ${optionLabel(selectedPrediction.rank).toLowerCase()} your schedule?`}
          description="Your current schedule will be replaced with this option."
          size="small"
          returnFocusRef={optionTitleRef}
          onClose={() => setConfirmingApply(false)}
          footer={<>
            <button className="button button-secondary" type="button" onClick={() => setConfirmingApply(false)}>Keep my schedule</button>
            <button className="button button-primary" type="button" onClick={() => { setConfirmingApply(false); void applyPrediction(selectedJob, selectedPrediction) }}>Replace my schedule</button>
          </>}
        >
          {selectedChanges && selectedChanges.length > 0 ? (
            <div className="engine-confirm-changes">
              <p>{periodsChangeLabel(changedPeriods(selectedChanges))}:</p>
              <ChangeList changes={selectedChanges} compact />
            </div>
          ) : null}
          <p className="muted">You can still edit any class on My schedule afterward.</p>
        </Dialog>
      ) : null}

      {confirmingCancelJob ? (
        <Dialog
          role="alertdialog"
          title="Cancel this request?"
          description="It hasn’t started yet. You can send a new one any time."
          size="small"
          returnFocusRef={requestTitleRef}
          onClose={() => setConfirmingCancelJobId(null)}
          footer={<>
            <button className="button button-secondary" type="button" onClick={() => setConfirmingCancelJobId(null)}>Keep request</button>
            <button className="button button-danger" type="button" onClick={() => { const jobId = confirmingCancelJob.id; setConfirmingCancelJobId(null); void cancelJob(jobId) }}>Cancel request</button>
          </>}
        >
          <p>Swap {swapNames(confirmingCancelJob).from} for {swapNames(confirmingCancelJob).to}</p>
        </Dialog>
      ) : null}
    </div>
  )
}

function formChecks({
  sourceEnrollments,
  replacementCourses,
  replacementSelectionsComplete,
  sourceCreditUnits,
  creditMatchPossible,
  singleStudyHallSelection,
  problem,
}: {
  sourceEnrollments: ScheduleEnrollment[]
  replacementCourses: CourseNameSearchResult[]
  replacementSelectionsComplete: boolean
  sourceCreditUnits: number
  creditMatchPossible: boolean
  singleStudyHallSelection: boolean
  problem: FormProblem | null
}): CheckItem[] {
  const items: CheckItem[] = [{
    id: 'schedule',
    state: 'done',
    title: 'Every period is filled',
    detail: 'One class per period on A and B days, in both semesters.',
  }]

  const choicesDone = sourceEnrollments.length > 0 && replacementCourses.length > 0 && replacementSelectionsComplete
  items.push({
    id: 'choices',
    state: choicesDone ? 'done' : 'pending',
    title: choicesDone ? 'Swap chosen' : 'Choose your swap',
    detail: choicesDone
      ? `Drop ${andList.format(sourceEnrollments.map((enrollment) => enrollment.class.course_name))}. Add ${andList.format(replacementCourses.map((course) => course.course_name))}.`
      : sourceEnrollments.length === 0
        ? 'Pick at least one course to drop.'
        : replacementCourses.length === 0
          ? 'Search the catalog for a course to add.'
          : 'Pick a catalog course in every search box, or remove the empty one.',
  })

  const creditRules = 'Semester and A/B-only full-year courses are 0.5 credits, full-year courses are 1.0, and double-period courses are 1.5.'
  const studyHallNote = singleStudyHallSelection ? ' If it helps the credits match, one Study Hall selection can become two half-credit Study Halls.' : ''
  if (!choicesDone) {
    items.push({
      id: 'credits',
      state: 'pending',
      title: 'Credits match',
      detail: sourceCreditUnits > 0 ? `You’re dropping ${creditsLabel(sourceCreditUnits)}. Schedule Engine only returns equal-credit swaps.` : 'Schedule Engine only returns equal-credit swaps.',
    })
  } else if (creditMatchPossible) {
    items.push({
      id: 'credits',
      state: 'done',
      title: 'Credits can match',
      announcement: 'Credits can match.',
      detail: `Dropping ${creditsLabel(sourceCreditUnits)}. Your additions could count for ${creditTotalsLabel(possibleReplacementCreditTotals(replacementCourses))}.${studyHallNote} Final matching uses real sections.`,
    })
  } else {
    items.push({
      id: 'credits',
      state: 'problem',
      title: 'Credits don’t match',
      announcement: `Credits don’t match. You’re dropping ${creditsLabel(sourceCreditUnits)}, but your additions can only count for ${creditTotalsLabel(possibleReplacementCreditTotals(replacementCourses))}.`,
      detail: <>
        <p>You’re dropping {creditsLabel(sourceCreditUnits)}, but your additions can only count for {creditTotalsLabel(possibleReplacementCreditTotals(replacementCourses))}. Add, remove, or change a course so the totals can match.</p>
        <p className="engine-check-rule">{creditRules}{studyHallNote}</p>
      </>,
    })
  }

  if (problem && problem.kind === 'rule') {
    items.push({ id: 'rule', state: 'problem', title: 'Fix your choices', detail: problem.message, announcement: `Fix your choices: ${problem.message}` })
  }
  return items
}
