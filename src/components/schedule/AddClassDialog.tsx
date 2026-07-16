import { AlertTriangle, Filter, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../../hooks/useClassSearch'
import { useCourseNameSearch, type CourseNameSearchExecutor } from '../../hooks/useCourseNameSearch'
import type { AcademicTerm, ClassDefinition, ClassSearchResult, CourseNameSearchResult, DayType, ScheduleEnrollment } from '../../lib/domain'
import { buildNormalMeetingSlots, defaultDoubleMeetingSlots, defaultMeetingSlots, type MeetingDaySelection, validateMeetingSlots } from '../../lib/schedule'
import { classFromSearch, createClassAndEnroll, enrollInClass, replaceEnrollment, searchClasses } from '../../lib/supabase/data'
import { normalizeTeacherLastName, teacherLastNameError } from '../../lib/teacher'
import { MeetingSlotEditor } from './MeetingSlotEditor'

interface AddClassDialogProps {
  open: boolean
  dayType: DayType
  period: number
  replacing?: ScheduleEnrollment | null
  onClose: () => void
  onChanged: () => Promise<void>
  onDemoAdd: (classDefinition: ClassDefinition, term: AcademicTerm) => void
}

const demoResults: ClassSearchResult[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    course_name_id: 'catalog-academic-physics',
    course_name: 'Academic Physics',
    teacher_last_name: 'Kim',
    default_academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 100,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    course_name_id: 'catalog-ap-physics-1',
    course_name: 'AP Physics 1',
    teacher_last_name: 'Chen',
    default_academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 88,
  },
]

const demoCourseNames: CourseNameSearchResult[] = [
  { id: 'catalog-academic-physics', course_name: 'Academic Physics', score: 100 },
  { id: 'catalog-ap-physics-1', course_name: 'AP Physics 1', score: 92 },
  { id: 'catalog-ap-physics-12', course_name: 'AP Physics 1&2', score: 88 },
]

export function AddClassDialog({ open, dayType, period, replacing, onClose, onChanged, onDemoAdd }: AddClassDialogProps) {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClassSearchResult | null>(null)
  const [term, setTerm] = useState<AcademicTerm>('full_year')
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allowConflict, setAllowConflict] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')
  const [selectedCourseName, setSelectedCourseName] = useState<CourseNameSearchResult | null>(null)
  const [teacherLastName, setTeacherLastName] = useState('')
  const [isDoublePeriod, setIsDoublePeriod] = useState(false)
  const [meetingDays, setMeetingDays] = useState<MeetingDaySelection>('both')
  const [meetingPeriod, setMeetingPeriod] = useState(period)
  const [meetingSlots, setMeetingSlots] = useState(() => defaultMeetingSlots(dayType, period))
  const [confirmedNoCourseMatch, setConfirmedNoCourseMatch] = useState(false)
  const executeSearch = useMemo<ClassSearchExecutor>(() => isDemo
    ? async (input) => demoResults
        .filter((result) => `${result.course_name} ${result.teacher_last_name}`.toLowerCase().includes(input.query.toLowerCase()))
        .map((result) => ({
          ...result,
          meeting_slots: input.dayType && input.period ? [{ day_type: input.dayType, period_number: input.period }] : result.meeting_slots,
        }))
    : searchClasses, [isDemo])
  const executeCourseNameSearch = useMemo<CourseNameSearchExecutor | undefined>(() => isDemo
    ? async (input) => {
        const normalized = input.trim().replace(/\s+/g, ' ').toLowerCase()
        return demoCourseNames.filter((result) => !normalized || result.course_name.toLowerCase().includes(normalized))
      }
    : undefined, [isDemo])
  const { error: searchError, loading, results } = useClassSearch(
    { query, dayType, period },
    { enabled: open && mode === 'search', search: executeSearch },
  )
  const courseSearch = useCourseNameSearch(courseQuery, {
    enabled: open && mode === 'create',
    ...(executeCourseNameSearch ? { search: executeCourseNameSearch } : {}),
  })

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(null)
    setTerm(replacing?.academic_term ?? 'full_year')
    setMode('search')
    setError(null)
    setAllowConflict(false)
    setCourseQuery('')
    setSelectedCourseName(null)
    setTeacherLastName('')
    setIsDoublePeriod(false)
    setMeetingDays('both')
    setMeetingPeriod(period)
    setMeetingSlots(defaultMeetingSlots(dayType, period))
    setConfirmedNoCourseMatch(false)
  }, [dayType, open, period, replacing?.academic_term])

  useEffect(() => {
    setSelected((current) => current && results.some((item) => item.id === current.id) ? current : null)
  }, [results])

  const context = `${dayType} Day · Period ${period}`
  const normalMeetingSlots = buildNormalMeetingSlots(meetingDays, meetingPeriod)
  const activeMeetingSlots = isDoublePeriod ? meetingSlots : normalMeetingSlots
  const meetingSlotError = validateMeetingSlots(activeMeetingSlots, isDoublePeriod)
  const teacherError = teacherLastName ? teacherLastNameError(teacherLastName) : null
  const newCourseName = courseQuery.trim().replace(/\s+/g, ' ')
  const canCreate = Boolean(selectedCourseName || (newCourseName.length >= 2 && confirmedNoCourseMatch))
    && !teacherLastNameError(teacherLastName)
    && !meetingSlotError

  function changeDoublePeriod(nextIsDoublePeriod: boolean) {
    setIsDoublePeriod(nextIsDoublePeriod)
    setMeetingSlots(nextIsDoublePeriod ? defaultDoubleMeetingSlots(dayType, meetingPeriod) : normalMeetingSlots)
  }

  function changeMeetingDays(nextMeetingDays: MeetingDaySelection) {
    setMeetingDays(nextMeetingDays)
    if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(nextMeetingDays, meetingPeriod))
  }

  function changeMeetingPeriod(nextMeetingPeriod: number) {
    setMeetingPeriod(nextMeetingPeriod)
    if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(meetingDays, nextMeetingPeriod))
  }

  async function confirmSelection() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      if (isDemo) onDemoAdd(classFromSearch(selected), term)
      else if (replacing) await replaceEnrollment(replacing.id, selected.id, term, allowConflict)
      else await enrollInClass(selected.id, term, allowConflict)
      await onChanged()
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not add this class.'
      if (message.includes('schedule_conflict')) {
        setError('This class conflicts with another active class in the same semester. Review the conflict, then confirm if you still want to add it.')
        setAllowConflict(true)
      } else setError(message)
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
        teacher_last_name: normalizeTeacherLastName(teacherLastName),
        default_academic_term: term,
        is_double_period: isDoublePeriod,
        meeting_slots: activeMeetingSlots,
      }
      if (isDemo) onDemoAdd(definition, term)
      else await createClassAndEnroll({
        courseNameId: selectedCourseName?.id,
        newCourseName: selectedCourseName ? undefined : newCourseName,
        teacherLastName,
        term,
        isDoublePeriod,
        meetingSlots: activeMeetingSlots,
        confirmedNoCourseMatch,
      })
      await onChanged()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create this class.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="class-dialog" role="dialog" aria-modal="true" aria-labelledby="add-class-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <div><h2 id="add-class-title">{replacing ? 'Replace class' : mode === 'create' ? 'Create a class' : 'Add a class'}</h2><p>{context}</p></div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {mode === 'search' ? (
          <>
            <div className="dialog-search-row">
              <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search class or teacher</span><input autoFocus placeholder="Search class or teacher" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <button className="button button-secondary" type="button"><Filter size={18} aria-hidden="true" /> Filters</button>
            </div>
            <div className="search-results" aria-live="polite">
              {loading ? <p className="muted">Searching…</p> : searchError ? null : results.length === 0 ? <p className="empty-inline">No classes match this cell and search.</p> : results.map((result) => (
                <label className={selected?.id === result.id ? 'class-result is-selected' : 'class-result'} key={result.id}>
                  <input type="radio" name="class-result" checked={selected?.id === result.id} onChange={() => { setSelected(result); setTerm(result.default_academic_term) }} />
                  <span><strong>{result.course_name}</strong><small>{result.teacher_last_name}</small><em>{result.meeting_slots.map((slot) => `${slot.day_type} Day · P${slot.period_number}`).join(' · ')} <i /> {result.default_academic_term === 'full_year' ? 'Full Year' : result.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</em></span>
                </label>
              ))}
            </div>
            <div className="term-field"><label>Enrollment term<select value={term} onChange={(event) => setTerm(event.target.value as AcademicTerm)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label></div>
            <div className="cant-find"><span>Can’t find the right class?</span><button className="button button-secondary" type="button" onClick={() => setMode('create')}><Plus aria-hidden="true" /> Create a new class</button></div>
            {searchError || error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{searchError ?? error}</span></div> : null}
            <button className="button button-primary button-block dialog-primary" type="button" disabled={!selected || saving} onClick={() => void confirmSelection()}>{saving ? 'Saving…' : allowConflict ? 'Confirm and add anyway' : replacing ? 'Replace class' : 'Add class'}</button>
          </>
        ) : (
          <form className="create-class-form" onSubmit={(event) => void createClass(event)}>
            <div className="course-name-picker">
              <label>Course name
                <input
                  autoFocus
                  required={!selectedCourseName}
                  maxLength={120}
                  placeholder="Search the approved course catalog"
                  value={courseQuery}
                  onChange={(event) => {
                    setCourseQuery(event.target.value)
                    setSelectedCourseName(null)
                    setConfirmedNoCourseMatch(false)
                  }}
                />
              </label>
              <div className="course-name-results" aria-live="polite">
                {courseSearch.loading ? <p className="muted">Searching course names…</p> : courseSearch.error ? <p className="form-error">{courseSearch.error}</p> : courseSearch.results.slice(0, 6).map((courseName) => (
                  <button className={selectedCourseName?.id === courseName.id ? 'is-selected' : ''} type="button" key={courseName.id} onClick={() => {
                    setSelectedCourseName(courseName)
                    setCourseQuery(courseName.course_name)
                    setConfirmedNoCourseMatch(false)
                  }}>
                    {courseName.course_name}
                  </button>
                ))}
              </div>
              {selectedCourseName ? <p className="selected-course-name">Selected catalog course: <strong>{selectedCourseName.course_name}</strong></p> : newCourseName.length >= 2 && !courseSearch.loading ? (
                <label className="checkbox-row confirmation"><input type="checkbox" checked={confirmedNoCourseMatch} onChange={(event) => setConfirmedNoCourseMatch(event.target.checked)} /><span>I reviewed the similar course names above and need to create “{newCourseName}”.</span></label>
              ) : null}
            </div>
            <label>Teacher Last Name
              <input required maxLength={120} value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} aria-describedby="teacher-last-name-help" />
              <small id="teacher-last-name-help" className="field-help">Enter only the teacher’s last name. For example, enter Smith instead of Joe Smith.</small>
            </label>
            {teacherError ? <p className="form-error" role="alert">{teacherError}</p> : null}
            <label>Academic term<select value={term} onChange={(event) => setTerm(event.target.value as AcademicTerm)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label>
            <MeetingSlotEditor
              isDoublePeriod={isDoublePeriod}
              meetingSlots={meetingSlots}
              meetingDays={meetingDays}
              meetingPeriod={meetingPeriod}
              onDoublePeriodChange={changeDoublePeriod}
              onMeetingDaysChange={changeMeetingDays}
              onMeetingPeriodChange={changeMeetingPeriod}
              onMeetingSlotsChange={setMeetingSlots}
            />
            {meetingSlotError ? <p className="form-error" role="alert">{meetingSlotError}</p> : null}
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setMode('search')}>Back to search</button><button className="button button-primary" disabled={!canCreate || saving}>{saving ? 'Creating…' : 'Create and add class'}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}
