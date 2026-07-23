import { AlertTriangle, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
  courseTermPolicy,
  defaultDoubleMeetingSlots,
  defaultMeetingSlots,
  enrollmentMeetingSlots,
  formatMeetingSlotSummary,
  hasMultiplePeriodsOnAnyDay,
  meetingSlotsForDay,
  PERIOD_NUMBERS,
  sortMeetingSlots,
  validateMeetingSlots,
} from '../../lib/schedule'
import { classFromSearch, createClassAndEnroll, createClassAndReplaceEnrollment, enrollInClass, replaceEnrollment, searchClasses } from '../../lib/supabase/data'
import { normalizeTeacherLastName, teacherLastNameError } from '../../lib/teacher'
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
  return policy === 'full_year' ? 'full_year' : semester
}

function semesterEveryDaySlots(period: number): MeetingSlot[] {
  return [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]
}

function teacherNotApplicable(courseName?: string): boolean {
  const normalized = courseName?.trim().toLocaleLowerCase().replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ')
  return normalized === 'lunch'
    || normalized === 'lunch nai'
    || normalized === 'lunch nash'
    || normalized === 'study hall'
    || normalized === 'study hall nai'
    || normalized === 'study hall nash'
}

function scheduleRuleError(policy: CourseTermPolicy, term: AcademicTerm, meetingSlots: MeetingSlot[], isDoublePeriod: boolean): string | null {
  const slotError = validateMeetingSlots(meetingSlots, isDoublePeriod)
  if (slotError) return slotError
  const aSlots = meetingSlotsForDay(meetingSlots, 'A')
  const bSlots = meetingSlotsForDay(meetingSlots, 'B')

  if (policy === 'full_year' && term !== 'full_year') return 'This course is full year.'
  if (policy === 'semester' && term === 'full_year') return 'Choose Semester 1 or Semester 2 for this half-credit course.'
  if (policy === 'flexible_attendance') {
    if (isDoublePeriod) return 'Gym, Wellness, and Study Hall cannot use a double-period attendance pattern.'
    if (term === 'full_year' && meetingSlots.length !== 1) return 'A full-year entry must meet only on A days or only on B days.'
    if (term !== 'full_year' && (aSlots.length !== 1 || bSlots.length !== 1 || meetingSlots.length !== 2)) {
      return 'A semester entry must meet once on every A and B day.'
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

  useEffect(() => {
    setSelected((current) => {
      if (!current || current.id === replacing?.class_id) return current
      return results.some((item) => item.id === current.id) ? current : null
    })
  }, [replacing?.class_id, results])

  const selectedPolicy = policyOf(selected)
  const newCourseName = courseQuery.trim().replace(/\s+/g, ' ')
  const creatingPolicy = policyOf(selectedCourseName)
  const activePolicy = mode === 'search' ? selectedPolicy : creatingPolicy
  const activeCourseName = mode === 'search' ? selected?.course_name : selectedCourseName?.course_name ?? newCourseName
  const teacherIsNotApplicable = teacherNotApplicable(activeCourseName)
  const effectiveTeacherLastName = teacherIsNotApplicable ? 'N/A' : teacherLastName
  const meetingSlotError = scheduleRuleError(activePolicy, term, meetingSlots, isDoublePeriod)
  const teacherError = teacherIsNotApplicable || !teacherLastName ? null : teacherLastNameError(teacherLastName)
  const canCreate = Boolean(selectedCourseName || (newCourseName.length >= 2 && confirmedNoCourseMatch))
    && (teacherIsNotApplicable || !teacherLastNameError(teacherLastName))
    && !meetingSlotError

  function selectClass(result: ClassSearchResult) {
    const policy = courseTermPolicy(result)
    setSelected(result)
    setError(null)
    setIsDoublePeriod(result.is_double_period)
    if (policy === 'flexible_attendance') {
      setTerm(semester)
      setMeetingSlots(semesterEveryDaySlots(period))
    } else if (policy === 'lunch') {
      setTerm(semester)
      setMeetingSlots(result.meeting_slots)
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
    setMeetingSlots(policy === 'flexible_attendance' || policy === 'lunch'
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
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create this class.'
      setError(message.includes('conflict')
        ? 'This entry conflicts with another class or lunch in the same semester and day.'
        : message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  const context = `${semester === 'semester_1' ? 'Semester 1' : 'Semester 2'} · ${dayType} Day · Period ${period}`
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="class-dialog" role="dialog" aria-modal="true" aria-labelledby="add-class-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <div><h2 id="add-class-title">{replacing ? 'Edit class entry' : mode === 'create' ? 'Create a class' : 'Add a class'}</h2><p>{context}</p></div>
          <button className="icon-button" type="button" aria-label="Close" autoFocus={!shouldAutoFocus} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {mode === 'search' ? (
          <>
            <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search class or teacher</span><input autoFocus={shouldAutoFocus} placeholder="Search class or teacher" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="search-results" aria-live="polite">
              {loading ? <p className="muted">Searching…</p> : searchError ? null : results.length === 0 ? <p className="empty-inline">No classes match this semester and period.</p> : results.map((result) => (
                <label className={selected?.id === result.id ? 'class-result is-selected' : 'class-result'} key={result.id}>
                  <input type="radio" name="class-result" checked={selected?.id === result.id} onChange={() => selectClass(result)} />
                  <span><strong>{result.course_name}</strong><small>{result.teacher_last_name}</small><em><span>{formatMeetingSlotSummary(result.meeting_slots)}</span><i /><span>{result.default_academic_term === 'full_year' ? 'Full Year' : result.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</span></em></span>
                </label>
              ))}
            </div>
            {selected ? <SelectedAttendanceControls policy={selectedPolicy} term={term} meetingSlots={meetingSlots} onChange={(nextTerm, nextSlots) => { setTerm(nextTerm); setMeetingSlots(nextSlots) }} /> : null}
            <div className="cant-find"><span>Can’t find the right class?</span><button className="button button-secondary" type="button" onClick={() => setMode('create')}><Plus aria-hidden="true" /> Create a new class</button></div>
            {searchError || error || meetingSlotError ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{searchError ?? error ?? meetingSlotError}</span></div> : null}
            <div className="dialog-action-bar"><button className="button button-primary button-block" type="button" disabled={!selected || saving || Boolean(meetingSlotError)} onClick={() => void confirmSelection()}>{saving ? 'Saving…' : replacing ? 'Save class entry' : 'Add class'}</button></div>
          </>
        ) : (
          <form className="create-class-form" onSubmit={(event) => void createClass(event)}>
            <div className="course-name-picker">
              <label>Course name
                <input
                  autoFocus={shouldAutoFocus}
                  required={!selectedCourseName}
                  maxLength={120}
                  placeholder="Search the approved course catalog"
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
              </label>
              <div className="course-name-results" aria-live="polite">
                {courseSearch.loading ? <p className="muted">Searching course names…</p> : courseSearch.error ? <p className="form-error">{courseSearch.error}</p> : courseSearch.results.slice(0, 6).map((courseName) => (
                  <button className={selectedCourseName?.id === courseName.id ? 'is-selected' : ''} type="button" key={courseName.id} onClick={() => selectCourseName(courseName)}>{courseName.course_name}</button>
                ))}
              </div>
              {selectedCourseName ? <p className="selected-course-name">Selected catalog course: <strong>{selectedCourseName.course_name}</strong></p> : newCourseName.length >= 2 && !courseSearch.loading ? (
                <label className="checkbox-row confirmation"><input type="checkbox" checked={confirmedNoCourseMatch} onChange={(event) => setConfirmedNoCourseMatch(event.target.checked)} /><span>I reviewed the similar course names above and need to create “{newCourseName}”. Unlisted courses are full year.</span></label>
              ) : null}
            </div>
            <label>Teacher Last Name
              <input required={!teacherIsNotApplicable} disabled={teacherIsNotApplicable} maxLength={120} value={effectiveTeacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} aria-describedby="teacher-last-name-help" />
              <small id="teacher-last-name-help" className="field-help">{teacherIsNotApplicable ? 'Lunch and Study Hall always use N/A for the teacher.' : 'Enter only the teacher’s last name. For example, enter Smith instead of Joe Smith.'}</small>
            </label>
            {teacherError ? <p className="form-error" role="alert">{teacherError}</p> : null}
            <NewCourseFormatControls policy={creatingPolicy} term={term} meetingSlots={meetingSlots} onChange={(nextTerm, nextSlots) => { setTerm(nextTerm); setMeetingSlots(nextSlots) }} />
            {creatingPolicy !== 'flexible_attendance' && creatingPolicy !== 'lunch' ? <MeetingSlotEditor isDoublePeriod={isDoublePeriod} meetingSlots={meetingSlots} onDoublePeriodChange={changeDoublePeriod} onMeetingSlotsChange={setMeetingSlots} /> : null}
            {meetingSlotError ? <p className="form-error" role="alert">{meetingSlotError}</p> : null}
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setMode('search')}>Back to search</button><button className="button button-primary" disabled={!canCreate || saving}>{saving ? 'Creating…' : 'Create and add class'}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}

function SelectedAttendanceControls({ policy, term, meetingSlots, onChange }: {
  policy: CourseTermPolicy
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  if (policy === 'flexible_attendance') return <FlexibleAttendanceControls term={term} meetingSlots={meetingSlots} onChange={onChange} />
  if (policy === 'lunch') return <LunchControls term={term} meetingSlots={meetingSlots} onChange={onChange} periodLocked />
  return <div className="term-field"><p><span>Academic term</span><strong>{term === 'full_year' ? 'Full Year' : term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</strong></p></div>
}

function NewCourseFormatControls({ policy, term, meetingSlots, onChange }: {
  policy: CourseTermPolicy
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  if (policy === 'full_year') return <div className="term-field"><p><span>Academic term</span><strong>Full Year</strong></p></div>
  if (policy === 'semester') return <SemesterSelect label="Semester" term={term} onChange={(nextTerm) => onChange(nextTerm, meetingSlots)} />
  if (policy === 'flexible_attendance') return <FlexibleAttendanceControls term={term} meetingSlots={meetingSlots} onChange={onChange} />
  if (policy === 'lunch') return <LunchControls term={term} meetingSlots={meetingSlots} onChange={onChange} />
  return <label>{policy === 'variable_credit' ? 'Credit and term' : 'Course version format'}
    <select value={term} onChange={(event) => onChange(event.target.value as AcademicTerm, meetingSlots)}>
      <option value="full_year">{policy === 'variable_credit' ? '1.0 credit · Full Year' : 'Full-year version'}</option>
      <option value="semester_1">{policy === 'variable_credit' ? '0.5 credit · Semester 1' : 'Semester 1 version'}</option>
      <option value="semester_2">{policy === 'variable_credit' ? '0.5 credit · Semester 2' : 'Semester 2 version'}</option>
    </select>
    <small className="field-help">Use the format shown for your specific course version.</small>
  </label>
}

function SemesterSelect({ label, term, onChange }: { label: string; term: AcademicTerm; onChange: (term: SemesterTerm) => void }) {
  return <label>{label}<select value={term === 'full_year' ? 'semester_1' : term} onChange={(event) => onChange(event.target.value as SemesterTerm)}><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label>
}

function FlexibleAttendanceControls({ term, meetingSlots, onChange }: {
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
}) {
  const onlyDay = meetingSlots[0]?.day_type ?? 'A'
  const pattern = term === 'full_year' ? `full_year_${onlyDay}` : term
  const fallback = meetingSlots[0]?.period_number ?? 1
  const aPeriod = meetingSlotsForDay(meetingSlots, 'A')[0]?.period_number ?? fallback
  const bPeriod = meetingSlotsForDay(meetingSlots, 'B')[0]?.period_number ?? fallback

  function changePattern(nextPattern: string) {
    if (nextPattern === 'full_year_A' || nextPattern === 'full_year_B') {
      const nextDay = nextPattern.endsWith('_A') ? 'A' : 'B'
      onChange('full_year', [{ day_type: nextDay, period_number: nextDay === 'A' ? aPeriod : bPeriod }])
      return
    }
    onChange(nextPattern as SemesterTerm, [{ day_type: 'A', period_number: aPeriod }, { day_type: 'B', period_number: bPeriod }])
  }

  function changePeriod(dayType: DayType, nextPeriod: number) {
    if (term === 'full_year') {
      onChange(term, [{ day_type: onlyDay, period_number: nextPeriod }])
      return
    }
    onChange(term, sortMeetingSlots([
      { day_type: 'A', period_number: dayType === 'A' ? nextPeriod : aPeriod },
      { day_type: 'B', period_number: dayType === 'B' ? nextPeriod : bPeriod },
    ]))
  }

  return <fieldset className="meeting-slot-picker special-attendance-picker"><legend>Attendance pattern</legend>
    <label>Format<select value={pattern} onChange={(event) => changePattern(event.target.value)}><option value="semester_1">Semester 1 · Every day</option><option value="semester_2">Semester 2 · Every day</option><option value="full_year_A">Full Year · A days only</option><option value="full_year_B">Full Year · B days only</option></select></label>
    <div className="two-field-row">
      {term !== 'full_year' || onlyDay === 'A' ? <DayPeriodSelect dayType="A" value={aPeriod} onChange={changePeriod} /> : null}
      {term !== 'full_year' || onlyDay === 'B' ? <DayPeriodSelect dayType="B" value={bPeriod} onChange={changePeriod} /> : null}
    </div>
    <p className="inferred-slot">Meeting slots: <strong>{formatMeetingSlotSummary(meetingSlots)}</strong></p>
  </fieldset>
}

function LunchControls({ term, meetingSlots, onChange, periodLocked = false }: {
  term: AcademicTerm
  meetingSlots: MeetingSlot[]
  onChange: (term: AcademicTerm, meetingSlots: MeetingSlot[]) => void
  periodLocked?: boolean
}) {
  const lunchPeriod = meetingSlots[0]?.period_number ?? 1
  return <fieldset className="meeting-slot-picker lunch-format-picker"><legend>Lunch schedule</legend>
    <label>Academic term<select value={term} onChange={(event) => onChange(event.target.value as AcademicTerm, meetingSlots)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label>
    {periodLocked ? <p className="inferred-slot">Period: <strong>{lunchPeriod}</strong></p> : <label>Period<select value={lunchPeriod} onChange={(event) => { const nextPeriod = Number(event.target.value); onChange(term, semesterEveryDaySlots(nextPeriod)) }}>{PERIOD_NUMBERS.map((option) => <option value={option} key={option}>Period {option}</option>)}</select></label>}
    <small className="field-help">Full Year adds matching Semester 1 and Semester 2 lunch entries at this period.</small>
  </fieldset>
}

function DayPeriodSelect({ dayType, value, onChange }: { dayType: DayType; value: number; onChange: (dayType: DayType, period: number) => void }) {
  return <label>{dayType} day period<select value={value} onChange={(event) => onChange(dayType, Number(event.target.value))}>{PERIOD_NUMBERS.map((option) => <option value={option} key={option}>Period {option}</option>)}</select></label>
}
