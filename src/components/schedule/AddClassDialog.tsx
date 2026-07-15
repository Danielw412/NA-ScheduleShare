import { AlertTriangle, Filter, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../../hooks/useClassSearch'
import type { AcademicTerm, ClassDefinition, ClassSearchResult, DayType, MeetingSlot, ScheduleEnrollment } from '../../lib/domain'
import { suggestedDoubleSlots } from '../../lib/schedule'
import { classFromSearch, createClassAndEnroll, enrollInClass, replaceEnrollment, searchClasses } from '../../lib/supabase/data'

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
    class_name: 'Physics',
    teacher_name: 'Dr. Kim',
    default_academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 100,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    class_name: 'AP Physics 1',
    teacher_name: 'Ms. Chen',
    default_academic_term: 'full_year',
    is_double_period: false,
    meeting_slots: [{ day_type: 'A', period_number: 7 }],
    score: 88,
  },
]

function normalizedDisplay(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function AddClassDialog({ open, dayType, period, replacing, onClose, onChanged, onDemoAdd }: AddClassDialogProps) {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClassSearchResult | null>(null)
  const [term, setTerm] = useState<AcademicTerm>('full_year')
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allowConflict, setAllowConflict] = useState(false)
  const [className, setClassName] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [isDouble, setIsDouble] = useState(false)
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>([{ day_type: dayType, period_number: period }])
  const [confirmedNoMatch, setConfirmedNoMatch] = useState(false)
  const executeSearch = useMemo<ClassSearchExecutor>(() => isDemo
    ? async (input) => demoResults
        .filter((result) => `${result.class_name} ${result.teacher_name}`.toLowerCase().includes(input.query.toLowerCase()))
        .map((result) => ({
          ...result,
          meeting_slots: input.dayType && input.period ? [{ day_type: input.dayType, period_number: input.period }] : result.meeting_slots,
        }))
    : searchClasses, [isDemo])
  const { error: searchError, loading, results } = useClassSearch(
    { query, dayType, period },
    { enabled: open && mode === 'search', search: executeSearch },
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(null)
    setTerm(replacing?.academic_term ?? 'full_year')
    setMode('search')
    setError(null)
    setAllowConflict(false)
    setClassName('')
    setTeacherName('')
    setIsDouble(false)
    setMeetingSlots([{ day_type: dayType, period_number: period }])
    setConfirmedNoMatch(false)
  }, [dayType, open, period, replacing?.academic_term])

  useEffect(() => {
    setSelected((current) => current && results.some((item) => item.id === current.id) ? current : null)
  }, [results])

  useEffect(() => {
    if (isDouble) setMeetingSlots(suggestedDoubleSlots({ day_type: dayType, period_number: period }))
    else setMeetingSlots([{ day_type: dayType, period_number: period }])
  }, [dayType, isDouble, period])

  const context = `${dayType} Day · Period ${period}`
  const canCreate = className.trim().length >= 2 && teacherName.trim().length >= 2 && confirmedNoMatch && (!isDouble || meetingSlots.length >= 2)
  const likelyDuplicates = useMemo(() => results.filter((result) => {
    const normalized = `${result.class_name} ${result.teacher_name}`.toLowerCase()
    return className && normalized.includes(className.trim().toLowerCase())
  }).slice(0, 3), [className, results])

  function toggleSlot(slot: MeetingSlot) {
    setMeetingSlots((current) => current.some((item) => item.day_type === slot.day_type && item.period_number === slot.period_number)
      ? current.filter((item) => item.day_type !== slot.day_type || item.period_number !== slot.period_number)
      : [...current, slot].sort((a, b) => a.day_type.localeCompare(b.day_type) || a.period_number - b.period_number))
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
        class_name: normalizedDisplay(className),
        teacher_name: normalizedDisplay(teacherName),
        default_academic_term: term,
        is_double_period: isDouble,
        meeting_slots: meetingSlots,
      }
      if (isDemo) onDemoAdd(definition, term)
      else await createClassAndEnroll({ className, teacherName, term, isDouble, meetingSlots, confirmedNoMatch })
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
                  <span><strong>{result.class_name}</strong><small>{result.teacher_name}</small><em>{result.meeting_slots.map((slot) => `${slot.day_type} Day · P${slot.period_number}`).join(' · ')} <i /> {result.default_academic_term === 'full_year' ? 'Full Year' : result.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</em></span>
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
            <div className="two-field-row"><label>Class name<input required maxLength={120} value={className} onChange={(event) => { setClassName(event.target.value); setConfirmedNoMatch(false) }} /></label><label>Teacher<input required maxLength={120} value={teacherName} onChange={(event) => { setTeacherName(event.target.value); setConfirmedNoMatch(false) }} /></label></div>
            <label>Academic term<select value={term} onChange={(event) => setTerm(event.target.value as AcademicTerm)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label>
            <label className="checkbox-row"><input type="checkbox" checked={isDouble} onChange={(event) => setIsDouble(event.target.checked)} /><span><strong>Double-period class</strong><small>Confirm every consecutive meeting slot below.</small></span></label>
            {isDouble ? <fieldset className="slot-picker"><legend>Meeting slots</legend>{(['A', 'B'] as DayType[]).map((day) => <div key={day}><strong>{day} Day</strong>{Array.from({ length: 8 }, (_, index) => index + 1).map((value) => <label key={value}><input type="checkbox" checked={meetingSlots.some((slot) => slot.day_type === day && slot.period_number === value)} onChange={() => toggleSlot({ day_type: day, period_number: value })} />P{value}</label>)}</div>)}</fieldset> : <p className="inferred-slot">Meeting slot: <strong>{context}</strong></p>}
            {likelyDuplicates.length ? <div className="duplicate-warning"><strong>Possible matches already exist</strong>{likelyDuplicates.map((result) => <button type="button" key={result.id} onClick={() => { setMode('search'); setSelected(result) }}>{result.class_name} · {result.teacher_name}</button>)}</div> : null}
            <label className="checkbox-row confirmation"><input type="checkbox" checked={confirmedNoMatch} onChange={(event) => setConfirmedNoMatch(event.target.checked)} /><span>I checked the suggestions and none is the correct class.</span></label>
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setMode('search')}>Back to search</button><button className="button button-primary" disabled={!canCreate || saving}>{saving ? 'Creating…' : 'Create and add class'}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}
