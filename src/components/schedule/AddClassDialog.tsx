import { AlertCircle, Check, CheckCircle2, Plus, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../../hooks/useClassSearch'
import { useCourseNameSearch, type CourseNameSearchExecutor } from '../../hooks/useCourseNameSearch'
import type {
  AcademicTerm,
  ClassDefinition,
  ClassSearchResult,
  CourseNameSearchResult,
  CourseTermPolicy,
  DayType,
  MeetingSlot,
  ScheduleEnrollment,
  SemesterTerm,
} from '../../lib/domain'
import {
  compactMeetingSlotLabels,
  courseTermPolicy,
  defaultDoubleMeetingSlots,
  defaultMeetingSlots,
  enrollmentMeetingSlots,
  hasMultiplePeriodsOnAnyDay,
  meetingSlotsForDay,
  PERIOD_NUMBERS,
  sortMeetingSlots,
  validateMeetingSlots,
} from '../../lib/schedule'
import { classFromSearch, createClassAndEnroll, createClassAndReplaceEnrollment, enrollInClass, replaceEnrollment, searchClasses } from '../../lib/supabase/data'
import { normalizeTeacherLastName, teacherLastNameError } from '../../lib/teacher'
import { Dialog } from '../ui/Dialog'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useToast } from '../ui/Toast'
import { MeetingSlotEditor } from './MeetingSlotEditor'

interface AddClassDialogProps {
  open: boolean
  dayType: DayType
  period: number
  semester: SemesterTerm
  replacing?: ScheduleEnrollment | null
  onClose: () => void
  onChanged: () => Promise<void>
  onDemoAdd: (classDefinition: ClassDefinition, term: AcademicTerm, replacingEnrollmentId?: string) => void
}

const demoResults: ClassSearchResult[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    course_name_id: 'catalog-academic-physics',
    course_name: 'Academic Physics',
    teacher_last_name: 'Kim',
    default_academic_term: 'full_year',
    course_term_policy: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 100,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    course_name_id: 'catalog-creative-writing',
    course_name: 'Creative Writing',
    teacher_last_name: 'Chen',
    default_academic_term: 'semester_1',
    course_term_policy: 'semester',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 88,
  },
]

const demoCourseNames: CourseNameSearchResult[] = [
  { id: 'catalog-academic-physics', course_name: 'Academic Physics', course_term_policy: 'full_year', score: 100 },
  { id: 'catalog-creative-writing', course_name: 'Creative Writing', course_term_policy: 'semester', score: 92 },
  { id: 'catalog-gym', course_name: 'Gym', course_term_policy: 'flexible_attendance', score: 88 },
]

function policyOf(course?: Pick<ClassDefinition, 'course_term_policy'> | Pick<CourseNameSearchResult, 'course_term_policy'> | null): CourseTermPolicy {
  return course?.course_term_policy ?? 'full_year'
}

function termForPolicy(policy: CourseTermPolicy, semester: SemesterTerm): AcademicTerm {
  return policy === 'full_year' || policy === 'lunch' ? 'full_year' : semester
}

function termLabel(term: AcademicTerm): string {
  if (term === 'full_year') return 'Full year'
  return term === 'semester_1' ? 'Semester 1' : 'Semester 2'
}

function semesterEveryDaySlots(period: number): MeetingSlot[] {
  return [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]
}

function normalizedSpecialCourseName(courseName?: string): string {
  return courseName?.trim().toLocaleLowerCase().replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ') ?? ''
}

function isLunchCourseName(courseName?: string): boolean {
  const normalized = normalizedSpecialCourseName(courseName)
  return normalized === 'lunch' || normalized === 'lunch nai' || normalized === 'lunch nash'
}

function isStudyHallCourseName(courseName?: string): boolean {
  const normalized = normalizedSpecialCourseName(courseName)
  return normalized === 'study hall' || normalized === 'study hall nai' || normalized === 'study hall nash'
}

function teacherNotApplicable(courseName?: string): boolean {
  return isLunchCourseName(courseName) || isStudyHallCourseName(courseName)
}

function isGroupedAttendanceResult(result: ClassSearchResult): boolean {
  return courseTermPolicy(result) === 'lunch' || courseTermPolicy(result) === 'flexible_attendance'
}

function groupedAttendanceKey(result: ClassSearchResult): string {
  const periods = [...new Set(result.meeting_slots.map((slot) => slot.period_number))]
    .sort((left, right) => left - right)
    .join(',')
  const teacher = courseTermPolicy(result) === 'lunch' ? 'N/A' : result.teacher_last_name.trim().toLocaleLowerCase()
  return `${result.course_name_id}:${teacher}:${periods}`
}

function distinctPeriods(meetingSlots: MeetingSlot[]): number[] {
  return [...new Set(meetingSlots.map((slot) => slot.period_number))].sort((left, right) => left - right)
}

/** Day facts for one search result, shown as separate chips instead of a joined string. */
function meetingPatternLabels(meetingSlots: MeetingSlot[]): string[] {
  if (meetingSlots.length === 0) return []
  if (distinctPeriods(meetingSlots).length > 1) return compactMeetingSlotLabels(meetingSlots)
  const days = new Set(meetingSlots.map((slot) => slot.day_type))
  if (days.has('A') && days.has('B')) return ['Every day']
  return [days.has('A') ? 'A days only' : 'B days only']
}

function specialResultRank(result: ClassSearchResult, semester: SemesterTerm, dayType: DayType, period: number): number {
  const matchingSlots = result.meeting_slots.filter((slot) => slot.period_number === period)
  const hasA = matchingSlots.some((slot) => slot.day_type === 'A')
  const hasB = matchingSlots.some((slot) => slot.day_type === 'B')
  if (result.default_academic_term === semester && hasA && hasB) return 0
  if (result.default_academic_term === 'full_year' && matchingSlots.some((slot) => slot.day_type === dayType)) return 1
  if (result.default_academic_term === semester) return 2
  if (result.default_academic_term === 'full_year') return 3
  return 4
}

function collapseSpecialCourseResults(results: ClassSearchResult[], semester: SemesterTerm, dayType: DayType, period: number): ClassSearchResult[] {
  const collapsed: ClassSearchResult[] = []
  const specialIndexes = new Map<string, number>()

  for (const result of results) {
    if (!isGroupedAttendanceResult(result)) {
      collapsed.push(result)
      continue
    }

    const key = groupedAttendanceKey(result)
    const existingIndex = specialIndexes.get(key)
    if (existingIndex === undefined) {
      specialIndexes.set(key, collapsed.length)
      collapsed.push(result)
      continue
    }

    if (specialResultRank(result, semester, dayType, period) < specialResultRank(collapsed[existingIndex], semester, dayType, period)) {
      collapsed[existingIndex] = result
    }
  }

  return collapsed
}

function automaticSpecialSlots(term: AcademicTerm, dayType: DayType, period: number, lunch: boolean): MeetingSlot[] {
  if (lunch || term !== 'full_year') return semesterEveryDaySlots(period)
  return [{ day_type: dayType, period_number: period }]
}

function scheduleRuleError(policy: CourseTermPolicy, term: AcademicTerm, meetingSlots: MeetingSlot[], isDoublePeriod: boolean, courseName = ''): string | null {
  const slotError = validateMeetingSlots(meetingSlots, isDoublePeriod)
  if (slotError) return slotError
  const aSlots = meetingSlotsForDay(meetingSlots, 'A')
  const bSlots = meetingSlotsForDay(meetingSlots, 'B')

  if (policy === 'full_year' && term !== 'full_year') return 'This course is full year.'
  if (policy === 'semester' && term === 'full_year') return 'Choose Semester 1 or Semester 2 for this half-credit course.'
  if (policy === 'flexible_attendance' || policy === 'sectioned_attendance') {
    if (isDoublePeriod) return 'Gym, Wellness, and Study Hall cannot use a double-period attendance pattern.'
    const fullYearStudyHallEveryDay = isStudyHallCourseName(courseName)
      && meetingSlots.length === 2
      && aSlots.length === 1
      && bSlots.length === 1
      && aSlots[0].period_number === bSlots[0].period_number
    if (term === 'full_year' && meetingSlots.length !== 1 && !fullYearStudyHallEveryDay) return 'A full-year entry must meet only on A days or only on B days.'
    if (term !== 'full_year' && (aSlots.length !== 1 || bSlots.length !== 1 || meetingSlots.length !== 2)) {
      return 'A semester entry must meet once on every A and B day.'
    }
    if (term !== 'full_year' && aSlots[0]?.period_number !== bSlots[0]?.period_number) {
      return 'A semester entry must use the same period on A and B days.'
    }
  }
  if (policy === 'lunch') {
    if (isDoublePeriod || aSlots.length !== 1 || bSlots.length !== 1 || aSlots[0].period_number !== bSlots[0].period_number) {
      return 'Lunch must use the same period on every A and B day.'
    }
  }
  return null
}

function classResultFromEnrollment(enrollment: ScheduleEnrollment): ClassSearchResult {
  return { ...enrollment.class, score: 100 }
}

export function AddClassDialog({ open, dayType, period, semester, replacing, onClose, onChanged, onDemoAdd }: AddClassDialogProps) {
  const { isDemo } = useAuth()
  const { showToast } = useToast()
  const shouldAutoFocus = typeof window === 'undefined'
    || typeof window.matchMedia !== 'function'
    || !window.matchMedia('(pointer: coarse), (max-width: 720px)').matches
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClassSearchResult | null>(null)
  const [term, setTerm] = useState<AcademicTerm>(semester)
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [courseQuery, setCourseQuery] = useState('')
  const [selectedCourseName, setSelectedCourseName] = useState<CourseNameSearchResult | null>(null)
  const [teacherLastName, setTeacherLastName] = useState('')
  const [isDoublePeriod, setIsDoublePeriod] = useState(false)
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(() => defaultMeetingSlots(dayType, period))
  const [confirmedNoCourseMatch, setConfirmedNoCourseMatch] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const attendanceRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const courseInputRef = useRef<HTMLInputElement>(null)
  const modeSwitchedRef = useRef(false)
  const selectionMadeRef = useRef(false)
  const ids = {
    results: useId(),
    attendance: useId(),
    form: useId(),
    course: useId(),
    teacher: useId(),
    teacherHelp: useId(),
    when: useId(),
  }

  const executeSearch = useMemo<ClassSearchExecutor>(() => isDemo
    ? async (input) => demoResults.filter((result) => {
        const textMatches = `${result.course_name} ${result.teacher_last_name}`.toLowerCase().includes(input.query.toLowerCase())
        const termMatches = result.default_academic_term === 'full_year' || result.default_academic_term === input.academicTerm
        return textMatches && termMatches
      })
    : searchClasses, [isDemo])
  const executeCourseNameSearch = useMemo<CourseNameSearchExecutor | undefined>(() => isDemo
    ? async (input) => {
        const normalized = input.trim().replace(/\s+/g, ' ').toLowerCase()
        return demoCourseNames.filter((result) => !normalized || result.course_name.toLowerCase().includes(normalized))
      }
    : undefined, [isDemo])
  const { error: searchError, loading, results } = useClassSearch(
    { query, dayType, period, academicTerm: semester },
    { enabled: open && mode === 'search', search: executeSearch },
  )
  const displayResults = useMemo(
    () => collapseSpecialCourseResults(results, semester, dayType, period),
    [dayType, period, results, semester],
  )
  const courseSearch = useCourseNameSearch(courseQuery, {
    enabled: open && mode === 'create',
    ...(executeCourseNameSearch ? { search: executeCourseNameSearch } : {}),
  })

  useEffect(() => {
    if (!open) return
    const existingSelection = replacing ? classResultFromEnrollment(replacing) : null
    const initialSlots = replacing ? enrollmentMeetingSlots(replacing) : defaultMeetingSlots(dayType, period)
    setQuery(replacing?.class.course_name ?? '')
    setSelected(existingSelection)
    setTerm(replacing?.academic_term ?? semester)
    setMode('search')
    setError(null)
    setCourseQuery('')
    setSelectedCourseName(null)
    setTeacherLastName('')
    setIsDoublePeriod(replacing ? hasMultiplePeriodsOnAnyDay(initialSlots) : false)
    setMeetingSlots(initialSlots)
    setConfirmedNoCourseMatch(false)
  }, [dayType, open, period, replacing, semester])

  // Focus the search field on open from an effect, not autoFocus. A parent's
  // effects run after its children's, so Dialog has already recorded the
  // control that opened it and returns focus there on close; autoFocus would
  // run first and make Dialog remember the search field instead.
  // Only when the dialog opens, not on every render.
  useEffect(() => {
    if (open && shouldAutoFocus) searchInputRef.current?.focus()
  }, [open])

  // The button that switched modes unmounts with the old mode, so move focus
  // into the new one instead of letting it fall to <body>.
  useEffect(() => {
    if (!modeSwitchedRef.current) return
    modeSwitchedRef.current = false
    const field = mode === 'search' ? searchInputRef.current : courseInputRef.current
    if (shouldAutoFocus) field?.focus()
    // On phones a focused field opens the keyboard, so focus the dialog
    // itself: its new title is announced and nothing pops up.
    else field?.closest<HTMLElement>('[aria-modal="true"]')?.focus({ preventScroll: true })
  }, [mode])

  function switchMode(nextMode: 'search' | 'create') {
    setError(null)
    modeSwitchedRef.current = true
    setMode(nextMode)
  }

  useEffect(() => {
    setSelected((current) => {
      if (!current || current.id === replacing?.class_id) return current
      return results.some((item) => item.id === current.id) ? current : null
    })
  }, [replacing?.class_id, results])

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])

  const selectedId = selected?.id
  useEffect(() => {
    if (!selectedId || !selectionMadeRef.current) return
    selectionMadeRef.current = false
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    attendanceRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [selectedId])

  const selectedPolicy = policyOf(selected)
  const newCourseName = courseQuery.trim().replace(/\s+/g, ' ')
  const creatingPolicy = policyOf(selectedCourseName)
  const activePolicy = mode === 'search' ? selectedPolicy : creatingPolicy
  const activeCourseName = (mode === 'search' ? selected?.course_name : selectedCourseName?.course_name ?? newCourseName) ?? ''
  const teacherIsNotApplicable = teacherNotApplicable(activeCourseName)
  const effectiveTeacherLastName = teacherIsNotApplicable ? 'N/A' : teacherLastName
  const meetingSlotError = mode === 'search' && !selected ? null : scheduleRuleError(activePolicy, term, meetingSlots, isDoublePeriod, activeCourseName)
  const teacherError = teacherIsNotApplicable || !teacherLastName ? null : teacherLastNameError(teacherLastName)
  const canCreate = Boolean(selectedCourseName || (newCourseName.length >= 2 && confirmedNoCourseMatch))
    && (teacherIsNotApplicable || !teacherLastNameError(teacherLastName))
    && !meetingSlotError

  function selectClass(result: ClassSearchResult) {
    const policy = courseTermPolicy(result)
    selectionMadeRef.current = true
    setSelected(result)
    setError(null)
    setIsDoublePeriod(result.is_double_period)
    if (policy === 'flexible_attendance') {
      setTerm(semester)
      setMeetingSlots(semesterEveryDaySlots(result.meeting_slots[0]?.period_number ?? period))
    } else if (policy === 'lunch') {
      setTerm('full_year')
      setMeetingSlots(semesterEveryDaySlots(period))
    } else {
      setTerm(result.default_academic_term)
      setMeetingSlots(result.meeting_slots)
    }
  }

  function selectCourseName(courseName: CourseNameSearchResult) {
    const policy = policyOf(courseName)
    setSelectedCourseName(courseName)
    setCourseQuery(courseName.course_name)
    setTeacherLastName(teacherNotApplicable(courseName.course_name) ? 'N/A' : '')
    setConfirmedNoCourseMatch(false)
    setTerm(termForPolicy(policy, semester))
    setIsDoublePeriod(false)
    setMeetingSlots(policy === 'flexible_attendance' || policy === 'sectioned_attendance' || policy === 'lunch'
      ? semesterEveryDaySlots(period)
      : defaultMeetingSlots(dayType, period))
  }

  function changeDoublePeriod(nextIsDoublePeriod: boolean) {
    setIsDoublePeriod(nextIsDoublePeriod)
    if (nextIsDoublePeriod) {
      setMeetingSlots(defaultDoubleMeetingSlots(dayType, meetingSlots[0]?.period_number ?? period))
      return
    }
    const nextSlots = (['A', 'B'] as DayType[]).flatMap((meetingDay) => meetingSlotsForDay(meetingSlots, meetingDay).slice(0, 1))
    setMeetingSlots(nextSlots.length > 0 ? sortMeetingSlots(nextSlots) : defaultMeetingSlots(dayType, period))
  }

  function changeAttendance(nextTerm: AcademicTerm, nextSlots: MeetingSlot[]) {
    setTerm(nextTerm)
    setMeetingSlots(nextSlots)
  }

  async function confirmSelection() {
    if (!selected || meetingSlotError) return
    setSaving(true)
    setError(null)
    try {
      const definition = { ...classFromSearch(selected), meeting_slots: meetingSlots }
      if (isDemo) onDemoAdd(definition, term, replacing?.id)
      else if (replacing) await replaceEnrollment(replacing.id, selected.id, term, meetingSlots)
      else await enrollInClass(selected.id, term, meetingSlots)
      await onChanged()
      showToast(replacing ? `Saved ${selected.course_name}.` : `Added ${selected.course_name} to your schedule.`)
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not add this class.'
      setError(message.includes('conflict')
        ? 'This entry conflicts with another class or lunch in the same semester and day. Move or remove the other entry first.'
        : message)
    } finally {
      setSaving(false)
    }
  }

  async function createClass(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return
    setSaving(true)
    setError(null)
    try {
      const definition: ClassDefinition = {
        id: crypto.randomUUID(),
        course_name_id: selectedCourseName?.id ?? crypto.randomUUID(),
        course_name: selectedCourseName?.course_name ?? newCourseName,
        course_term_policy: creatingPolicy,
        teacher_last_name: normalizeTeacherLastName(effectiveTeacherLastName),
        default_academic_term: term,
        is_double_period: isDoublePeriod,
        meeting_slots: meetingSlots,
      }
      const createInput = {
        courseNameId: selectedCourseName?.id,
        newCourseName: selectedCourseName ? undefined : newCourseName,
        teacherLastName: effectiveTeacherLastName,
        term,
        isDoublePeriod,
        meetingSlots,
        confirmedNoCourseMatch,
      }
      if (isDemo) onDemoAdd(definition, term, replacing?.id)
      else if (replacing) await createClassAndReplaceEnrollment(replacing.id, createInput)
      else await createClassAndEnroll(createInput)
      await onChanged()
      showToast(replacing ? `Saved ${definition.course_name}.` : `Added ${definition.course_name} to your schedule.`)
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create this class.'
      setError(message.includes('rate_limit_exceeded')
        ? 'You have created many new class sections recently. Wait a little while, or choose an existing section if one matches.'
        : message.includes('conflict')
          ? 'This entry conflicts with another class or lunch in the same semester and day.'
          : message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  const semesterLabel = semester === 'semester_1' ? 'Semester 1' : 'Semester 2'
  const titleText = replacing ? 'Edit class entry' : mode === 'create' ? 'Create a class' : 'Add a class'
  const selectedTeacher = selected && !teacherNotApplicable(selected.course_name) ? selected.teacher_last_name : null
  const saveError = error ? (
    <div className="notice notice-danger add-class-error" role="alert" ref={errorRef}>
      <AlertCircle aria-hidden="true" />
      <p>{error}</p>
    </div>
  ) : null

  const footer = mode === 'search' ? (
    <>
      <p className="add-class-footer-summary" aria-hidden="true">
        {selected ? <><strong>{selected.course_name}</strong>{selectedTeacher ? <span> with {selectedTeacher}</span> : null}</> : 'Choose a section to continue.'}
      </p>
      <button className="button button-primary" type="button" disabled={!selected || saving || Boolean(meetingSlotError)} onClick={() => void confirmSelection()}>
        {saving ? 'Saving…' : replacing ? 'Save class entry' : 'Add class'}
      </button>
    </>
  ) : (
    <>
      <button className="button button-secondary" type="button" disabled={saving} onClick={() => switchMode('search')}>Back to search</button>
      <button className="button button-primary" type="submit" form={ids.form} disabled={!canCreate || saving}>{saving ? 'Creating…' : 'Create and add class'}</button>
    </>
  )

  return (
    <Dialog
      title={<span className="add-class-title"><span className="period-numeral" aria-hidden="true">{period}</span><span>{titleText}</span></span>}
      description={`Period ${period} on ${dayType} days in ${semesterLabel}`}
      onClose={onClose}
      dismissible={!saving}
      className={mode === 'create' ? 'add-class-dialog is-creating' : 'add-class-dialog'}
      footer={footer}
    >
      {mode === 'search' ? (
        <>
          <label className="search-input add-class-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Search by course or teacher</span>
            <input
              ref={searchInputRef}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Search by course or teacher"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <section className="add-class-results-section" aria-labelledby={ids.results}>
            <div className="add-class-section-header">
              <h3 id={ids.results}>Choose your section</h3>
              {!loading && !searchError && displayResults.length > 0 ? <span className="section-count">{displayResults.length} {displayResults.length === 1 ? 'match' : 'matches'}</span> : null}
            </div>
            <div className="add-class-results" aria-live="polite" aria-busy={loading}>
              {loading ? (
                <div className="add-class-results-loading" role="status">
                  <span className="sr-only">Searching for classes…</span>
                  <span className="skeleton" aria-hidden="true" />
                  <span className="skeleton" aria-hidden="true" />
                  <span className="skeleton" aria-hidden="true" />
                </div>
              ) : searchError ? (
                <div className="notice notice-danger" role="alert"><AlertCircle aria-hidden="true" /><p>{searchError}</p></div>
              ) : displayResults.length === 0 ? (
                <p className="add-class-results-empty">No sections match this semester and period. Try the teacher’s last name, or create the class below.</p>
              ) : (
                <div className="add-class-result-list" role="radiogroup" aria-labelledby={ids.results}>
                  {displayResults.map((result) => (
                    <ClassResultRow
                      key={result.id}
                      result={result}
                      period={period}
                      checked={selected?.id === result.id}
                      onSelect={() => selectClass(result)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {selected ? (
            <section className="add-class-attendance" aria-labelledby={ids.attendance} ref={attendanceRef}>
              <div className="add-class-section-header">
                <h3 id={ids.attendance}>How you attend</h3>
              </div>
              <SelectedAttendanceControls
                policy={selectedPolicy}
                courseName={selected.course_name}
                term={term}
                meetingSlots={meetingSlots}
                dayType={dayType}
                period={period}
                onChange={changeAttendance}
              />
              {meetingSlotError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{meetingSlotError}</p> : null}
            </section>
          ) : null}

          {saveError}

          <div className="add-class-create-prompt">
            <p>Can’t find your section? Add it so classmates can find it too.</p>
            <button className="button button-secondary" type="button" onClick={() => switchMode('create')}><Plus aria-hidden="true" />Create a new class</button>
          </div>
        </>
      ) : (
        <form className="add-class-form" id={ids.form} onSubmit={(event) => void createClass(event)}>
          <div className="add-class-course">
            <div className="field">
              <label htmlFor={ids.course}>Course name</label>
              <div className="search-input">
                <Search aria-hidden="true" />
                <input
                  ref={courseInputRef}
                  id={ids.course}
                  autoComplete="off"
                  required={!selectedCourseName}
                  maxLength={120}
                  placeholder="Search the course catalog"
                  value={courseQuery}
                  onChange={(event) => {
                    setCourseQuery(event.target.value)
                    setSelectedCourseName(null)
                    setConfirmedNoCourseMatch(false)
                    setTeacherLastName(teacherNotApplicable(event.target.value) ? 'N/A' : '')
                    setTerm('full_year')
                    setIsDoublePeriod(false)
                    setMeetingSlots(defaultMeetingSlots(dayType, period))
                  }}
                />
              </div>
            </div>
            <div className="add-class-course-results" aria-live="polite">
              {courseSearch.loading ? <p className="add-class-course-status">Searching course names…</p> : courseSearch.error ? <p className="form-error"><AlertCircle aria-hidden="true" />{courseSearch.error}</p> : courseSearch.results.length > 0 ? (
                <ul className="add-class-course-list">
                  {courseSearch.results.slice(0, 6).map((courseName) => {
                    const isSelected = selectedCourseName?.id === courseName.id
                    return (
                      <li key={courseName.id}>
                        <button className={isSelected ? 'add-class-course-option is-selected' : 'add-class-course-option'} type="button" aria-pressed={isSelected} onClick={() => selectCourseName(courseName)}>
                          <span>{courseName.course_name}</span>
                          {isSelected ? <Check aria-hidden="true" /> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : newCourseName.length >= 2 ? <p className="add-class-course-status">No catalog course matches “{newCourseName}”.</p> : null}
            </div>
            {selectedCourseName ? (
              <p className="add-class-course-selected"><CheckCircle2 aria-hidden="true" /><span>Using <strong>{selectedCourseName.course_name}</strong> from the course catalog.</span></p>
            ) : newCourseName.length >= 2 && !courseSearch.loading ? (
              <label className="checkbox-row add-class-confirm">
                <input type="checkbox" checked={confirmedNoCourseMatch} onChange={(event) => setConfirmedNoCourseMatch(event.target.checked)} />
                <span>
                  <strong>Create “{newCourseName}” as a new course</strong>
                  <small>I checked the course names above and none of them match. Courses that aren’t in the catalog are full year.</small>
                </span>
              </label>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor={ids.teacher}>Teacher last name</label>
            <input
              id={ids.teacher}
              autoComplete="off"
              required={!teacherIsNotApplicable}
              disabled={teacherIsNotApplicable}
              maxLength={120}
              value={effectiveTeacherLastName}
              aria-invalid={teacherError ? true : undefined}
              aria-describedby={ids.teacherHelp}
              onChange={(event) => setTeacherLastName(event.target.value)}
            />
            <p id={ids.teacherHelp} className="field-help">{teacherIsNotApplicable ? 'Lunch and Study Hall always use N/A for the teacher.' : 'Enter only the last name, like Smith instead of Joe Smith.'}</p>
            {teacherError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{teacherError}</p> : null}
          </div>

          <section className="add-class-when" aria-labelledby={ids.when}>
            <h3 id={ids.when}>When it meets</h3>
            <NewCourseFormatControls policy={creatingPolicy} courseName={activeCourseName} term={term} meetingSlots={meetingSlots} dayType={dayType} period={period} onChange={changeAttendance} />
            {creatingPolicy !== 'flexible_attendance' && creatingPolicy !== 'sectioned_attendance' && creatingPolicy !== 'lunch' ? <MeetingSlotEditor isDoublePeriod={isDoublePeriod} meetingSlots={meetingSlots} onDoublePeriodChange={changeDoublePeriod} onMeetingSlotsChange={setMeetingSlots} /> : null}
            {meetingSlotError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{meetingSlotError}</p> : null}
          </section>

          {saveError}
        </form>
      )}
    </Dialog>
  )
}

function ClassResultRow({ result, period, checked, onSelect }: {
  result: ClassSearchResult
  period: number
  checked: boolean
  onSelect: () => void
}) {
  const grouped = isGroupedAttendanceResult(result)
  const hideTeacher = teacherNotApplicable(result.course_name)
  const periods = distinctPeriods(result.meeting_slots)
  const numeral = periods.includes(period) ? period : periods[0] ?? period
  const patternLabels = grouped
    ? periods.length > 1 ? periods.map((value) => `P${value}`) : []
    : meetingPatternLabels(result.meeting_slots)

  return (
    <label className={checked ? 'add-class-result is-selected' : 'add-class-result'}>
      <span className="period-numeral" aria-hidden="true">{numeral}</span>
      <span className="add-class-result-main">
        <strong>{result.course_name}</strong>
        <span className="sr-only">Period {numeral}</span>
        {hideTeacher ? null : <span className="add-class-result-teacher">{result.teacher_last_name}</span>}
        {grouped ? <span className="add-class-result-hint">{courseTermPolicy(result) === 'lunch' ? 'Choose your term next' : 'Choose your days and term next'}</span> : null}
        {patternLabels.length > 0 || !grouped ? (
          <span className="chip-list add-class-result-facts">
            {patternLabels.map((label) => <span className="chip" key={label}>{label}</span>)}
            {grouped ? null : <span className="chip add-class-result-term">{termLabel(result.default_academic_term)}</span>}
          </span>
        ) : null}
      </span>
      <input type="radio" name="class-result" checked={checked} onChange={onSelect} />
    </label>
  )
}

function MeetingPatternChips({ meetingSlots }: { meetingSlots: MeetingSlot[] }) {
  const labels = meetingPatternLabels(meetingSlots)
  if (labels.length === 0) return <span className="muted">No periods selected</span>
  return <span className="chip-list">{labels.map((label) => <span className="chip" key={label}>{label}</span>)}</span>
}

function SelectedAttendanceControls({ policy, courseName, term, meetingSlots, dayType, period, onChange }: {
  policy: CourseTermPolicy
  courseName: string
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  dayType: DayType
  period: number
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  if (policy === 'lunch') return <AutomaticSpecialCourseControls lunch term={term} dayType={dayType} period={period} onChange={onChange} />
  if (policy === 'flexible_attendance') return <FlexibleAttendanceControls fixedPeriod={meetingSlots[0]?.period_number ?? period} allowFullYearEveryDay={isStudyHallCourseName(courseName)} term={term} meetingSlots={meetingSlots} onChange={onChange} />
  const periods = distinctPeriods(meetingSlots)
  return (
    <dl className="facts add-class-facts">
      <dt>Academic term</dt>
      <dd><strong>{termLabel(term)}</strong></dd>
      <dt>{periods.length > 1 ? 'Periods' : 'Period'}</dt>
      <dd className="add-class-period-list">{periods.map((value) => <span className="period-numeral" key={value}>{value}</span>)}</dd>
      <dt>Meets</dt>
      <dd><MeetingPatternChips meetingSlots={meetingSlots} /></dd>
    </dl>
  )
}

function NewCourseFormatControls({ policy, courseName, term, meetingSlots, dayType, period, onChange }: {
  policy: CourseTermPolicy
  courseName: string
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  dayType: DayType
  period: number
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  if (policy === 'full_year') return <dl className="facts add-class-facts"><dt>Academic term</dt><dd><strong>Full year</strong></dd></dl>
  if (policy === 'semester') return <SemesterChoice term={term} onChange={(nextTerm) => onChange(nextTerm, meetingSlots)} />
  if (policy === 'lunch') return <AutomaticSpecialCourseControls lunch term={term} dayType={dayType} period={period} onChange={onChange} />
  if (policy === 'flexible_attendance' || policy === 'sectioned_attendance') return <FlexibleAttendanceControls allowFullYearEveryDay={policy === 'flexible_attendance' && isStudyHallCourseName(courseName)} term={term} meetingSlots={meetingSlots} onChange={onChange} />
  return <VersionedTermSelect policy={policy} term={term} onChange={(nextTerm) => onChange(nextTerm, meetingSlots)} />
}

function VersionedTermSelect({ policy, term, onChange }: { policy: CourseTermPolicy; term: AcademicTerm; onChange: (term: AcademicTerm) => void }) {
  const id = useId()
  const helpId = useId()
  const credit = policy === 'variable_credit'
  return (
    <div className="field">
      <label htmlFor={id}>{credit ? 'Credit and term' : 'Course version format'}</label>
      <select id={id} value={term} aria-describedby={helpId} onChange={(event) => onChange(event.target.value as AcademicTerm)}>
        <option value="full_year">{credit ? 'Full year, 1.0 credit' : 'Full-year version'}</option>
        <option value="semester_1">{credit ? 'Semester 1, 0.5 credit' : 'Semester 1 version'}</option>
        <option value="semester_2">{credit ? 'Semester 2, 0.5 credit' : 'Semester 2 version'}</option>
      </select>
      <p id={helpId} className="field-help">Use the format shown for your specific course version.</p>
    </div>
  )
}

function SemesterChoice({ term, onChange }: { term: AcademicTerm; onChange: (term: SemesterTerm) => void }) {
  return (
    <div className="field">
      <span className="field-label" aria-hidden="true">Semester</span>
      <SegmentedControl<SemesterTerm>
        label="Semester"
        value={term === 'full_year' ? 'semester_1' : term}
        options={[{ value: 'semester_1', label: 'Semester 1' }, { value: 'semester_2', label: 'Semester 2' }]}
        onChange={onChange}
        block
      />
    </div>
  )
}

function AutomaticSpecialCourseControls({ lunch = false, term, dayType, period, onChange }: {
  lunch?: boolean
  term: AcademicTerm
  dayType: DayType
  period: number
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  function changeTerm(nextTerm: AcademicTerm) {
    onChange(nextTerm, automaticSpecialSlots(nextTerm, dayType, period, lunch))
  }

  return (
    <div className="add-class-attendance-fields">
      <div className="field">
        <span className="field-label" aria-hidden="true">Academic term</span>
        <SegmentedControl<AcademicTerm>
          label="Academic term"
          value={term}
          options={[
            { value: 'full_year', label: 'Full year' },
            { value: 'semester_1', label: 'Semester 1' },
            { value: 'semester_2', label: 'Semester 2' },
          ]}
          onChange={changeTerm}
          block
        />
        <p className="field-help">{lunch ? 'Full year adds matching Semester 1 and Semester 2 lunch entries.' : `Full year uses ${dayType} days only. A semester uses every day.`}</p>
      </div>
      <dl className="facts add-class-facts">
        <dt>Period</dt>
        <dd className="add-class-fixed-period"><strong className="period-numeral">{period}</strong></dd>
      </dl>
    </div>
  )
}

function FlexibleAttendanceControls({ term, meetingSlots, fixedPeriod, allowFullYearEveryDay = false, onChange }: {
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  fixedPeriod?: number
  allowFullYearEveryDay?: boolean
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  const formatId = useId()
  const onlyDay = meetingSlots[0]?.day_type ?? 'A'
  const fallback = fixedPeriod ?? meetingSlots[0]?.period_number ?? 1
  const aSlots = meetingSlotsForDay(meetingSlots, 'A')
  const bSlots = meetingSlotsForDay(meetingSlots, 'B')
  const fullYearEveryDay = term === 'full_year'
    && aSlots.length === 1
    && bSlots.length === 1
    && aSlots[0].period_number === bSlots[0].period_number
  const pattern = term === 'full_year'
    ? fullYearEveryDay ? 'full_year_every_day' : `full_year_${onlyDay}`
    : term
  const aPeriod = aSlots[0]?.period_number ?? fallback
  const semesterPeriod = fixedPeriod ?? aPeriod

  function changePattern(nextPattern: string) {
    if (nextPattern === 'full_year_A' || nextPattern === 'full_year_B') {
      const nextDay = nextPattern.endsWith('_A') ? 'A' : 'B'
      onChange('full_year', [{ day_type: nextDay, period_number: term === 'full_year' ? fallback : semesterPeriod }])
      return
    }
    const nextPeriod = term === 'full_year' ? fallback : semesterPeriod
    if (nextPattern === 'full_year_every_day') {
      onChange('full_year', semesterEveryDaySlots(nextPeriod))
      return
    }
    onChange(nextPattern as SemesterTerm, semesterEveryDaySlots(nextPeriod))
  }

  function changePeriod(_dayType: DayType, nextPeriod: number) {
    if (term === 'full_year') {
      onChange(term, fullYearEveryDay
        ? semesterEveryDaySlots(nextPeriod)
        : [{ day_type: onlyDay, period_number: nextPeriod }])
      return
    }
    onChange(term, semesterEveryDaySlots(nextPeriod))
  }

  return (
    <div className="add-class-attendance-fields">
      <div className="field-row">
        <div className="field">
          <label htmlFor={formatId}>Format</label>
          <select id={formatId} value={pattern} onChange={(event) => changePattern(event.target.value)}>
            <option value="semester_1">Semester 1, every day</option>
            <option value="semester_2">Semester 2, every day</option>
            <option value="full_year_A">Full year, A days only</option>
            <option value="full_year_B">Full year, B days only</option>
            {allowFullYearEveryDay ? <option value="full_year_every_day">Full year, every day</option> : null}
          </select>
        </div>
        {fixedPeriod ? null : term === 'full_year' && !fullYearEveryDay
          ? <PeriodSelect label={`${onlyDay} day period`} value={fallback} onChange={(nextPeriod) => changePeriod(onlyDay, nextPeriod)} />
          : <PeriodSelect label="Period" value={term === 'full_year' ? aPeriod : semesterPeriod} onChange={(nextPeriod) => changePeriod('A', nextPeriod)} />}
      </div>
      <dl className="facts add-class-facts">
        {fixedPeriod ? <><dt>Period</dt><dd className="add-class-fixed-period"><strong className="period-numeral">{fixedPeriod}</strong></dd></> : null}
        <dt>Meets</dt>
        <dd aria-live="polite"><MeetingPatternChips meetingSlots={meetingSlots} /></dd>
      </dl>
    </div>
  )
}

function PeriodSelect({ label, value, onChange }: { label: string; value: number; onChange: (period: number) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {PERIOD_NUMBERS.map((option) => <option value={option} key={option}>Period {option}</option>)}
      </select>
    </div>
  )
}
