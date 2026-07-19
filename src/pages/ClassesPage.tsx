import { CalendarDays, ChevronRight, Flag, LockKeyhole, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { useAuth } from '../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../hooks/useClassSearch'
import { useNoIndex } from '../hooks/useNoIndex'
import { useSchedule } from '../hooks/useSchedule'
import { demoEnrollments } from '../lib/demo-data'
import type { ClassMemberResult, ClassSearchResult, DayType, ScheduleEnrollment } from '../lib/domain'
import { compactMeetingSlotLabels, formatMeetingSlotSummary, hasMultiplePeriodsOnAnyDay, PERIOD_NUMBERS } from '../lib/schedule'
import { getClassMembers, searchClasses, searchGuestClasses } from '../lib/supabase/data'

const demoClasses: ClassSearchResult[] = demoEnrollments.map((enrollment, index) => ({ ...enrollment.class, score: 100 - index }))

export function ClassesPage() {
  const { user } = useAuth()
  useNoIndex(!user)
  return user ? <AuthenticatedClassesPage /> : <GuestClassesPage />
}

function GuestClassesPage() {
  const { classId } = useParams()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { error, loading, results } = useClassSearch({
    query,
    dayType: dayType || undefined,
    period: period || undefined,
    limit: 1000,
  }, { search: searchGuestClasses })
  const selected = results.find((result) => result.id === classId)

  return (
    <div className="classes-page guest-classes-page">
      <header className="page-heading"><div><h1>View Classes</h1><p>Search actual classes by course, teacher, day, or period. Create an account to see who is enrolled.</p></div></header>
      <ClassFilterControls dayType={dayType} filtersOpen={filtersOpen} period={period} query={query} setDayType={setDayType} setFiltersOpen={setFiltersOpen} setPeriod={setPeriod} setQuery={setQuery} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="class-browser">
        <section className="class-list-panel organized-class-list">
          <section className="other-classes-section" aria-labelledby="guest-classes-heading">
            <div><h2 id="guest-classes-heading">Classes</h2><span>Current class catalog</span></div>
            <div className="class-list" aria-live="polite">
              {loading ? <p className="muted">Searching…</p> : results.map((result) => <ClassListRow active={classId === result.id} key={result.id} result={result} />)}
              {!loading && !error && results.length === 0 ? <p className="empty-inline">No matching classes.</p> : null}
            </div>
          </section>
        </section>
        {selected ? <Link className="mobile-class-detail-backdrop" to="/classes" aria-label="Close class details" /> : null}
        <section className={selected ? 'class-detail-panel is-open' : 'class-detail-panel'}>
          {selected ? <>
            <div className="sheet-handle" aria-hidden="true" />
            <Link className="mobile-class-detail-close icon-button" to="/classes" aria-label="Close class details"><X aria-hidden="true" /></Link>
            <div className="class-detail-heading"><div><h2>{selected.course_name}</h2><p>{selected.teacher_last_name}</p></div>{hasMultiplePeriodsOnAnyDay(selected.meeting_slots) ? <span className="status-tag">Multiple periods</span> : null}</div>
            <dl className="class-facts"><div><dt><CalendarDays size={18} /> Meeting slots</dt><dd>{formatMeetingSlotSummary(selected.meeting_slots)}</dd></div><div><dt>Default term</dt><dd>{selected.default_academic_term === 'full_year' ? 'Full Year' : selected.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</dd></div></dl>
            <section className="class-roster-locked"><LockKeyhole aria-hidden="true" /><p>Create an account and add your schedule to see who is in this class. Student privacy settings still apply.</p><button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create Account</button></section>
          </> : <div className="empty-state compact"><CalendarDays size={36} /><h2>Select a class</h2><p>Open a result to see its real meeting slots. Rosters remain private until you create an account.</p></div>}
        </section>
      </div>
    </div>
  )
}

function matchesFilters(result: ClassSearchResult, query: string, dayType: DayType | '', period: number | ''): boolean {
  const normalized = query.trim().toLowerCase()
  const matchesQuery = !normalized || `${result.course_name} ${result.teacher_last_name}`.toLowerCase().includes(normalized)
  const matchesDay = !dayType || result.meeting_slots.some((slot) => slot.day_type === dayType)
  const matchesPeriod = !period || result.meeting_slots.some((slot) => slot.period_number === period)
  const matchesCell = !dayType || !period || result.meeting_slots.some((slot) => slot.day_type === dayType && slot.period_number === period)
  return matchesQuery && matchesDay && matchesPeriod && matchesCell
}

function classResultFromEnrollment(enrollment: ScheduleEnrollment): ClassSearchResult {
  return { ...enrollment.class, score: 1000 }
}

function classTermLabel(term: ClassSearchResult['default_academic_term']): string {
  if (term === 'semester_1') return 'Semester 1'
  if (term === 'semester_2') return 'Semester 2'
  return 'Full Year'
}

interface ClassFilterControlsProps {
  query: string
  dayType: DayType | ''
  period: number | ''
  filtersOpen: boolean
  setQuery: (value: string) => void
  setDayType: (value: DayType | '') => void
  setPeriod: (value: number | '') => void
  setFiltersOpen: (value: boolean) => void
}

function ClassFilterControls({ query, dayType, period, filtersOpen, setQuery, setDayType, setPeriod, setFiltersOpen }: ClassFilterControlsProps) {
  const activeFilterCount = Number(Boolean(dayType)) + Number(Boolean(period))
  return <>
    <div className="search-toolbar class-page-search-toolbar">
      <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search classes</span><input placeholder="Course or teacher last name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button aria-controls="class-mobile-filter-panel" aria-expanded={filtersOpen} className="mobile-filter-toggle" type="button" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={18} aria-hidden="true" /> Filters{activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}</button>
      <div className={filtersOpen ? 'mobile-filter-panel is-open' : 'mobile-filter-panel'} id="class-mobile-filter-panel">
        <label><span>Day</span><select value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}><option value="">Any day</option><option value="A">A Day</option><option value="B">B Day</option></select></label>
        <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value ? Number(event.target.value) : '')}><option value="">Any period</option>{PERIOD_NUMBERS.map((value) => <option value={value} key={value}>Period {value}</option>)}</select></label>
      </div>
    </div>
    {activeFilterCount > 0 ? <div className="mobile-active-filters" aria-label="Active class filters">
      {dayType ? <button type="button" onClick={() => setDayType('')}>{dayType} Day <X size={14} aria-hidden="true" /></button> : null}
      {period ? <button type="button" onClick={() => setPeriod('')}>Period {period} <X size={14} aria-hidden="true" /></button> : null}
      <button className="clear-filter-button" type="button" onClick={() => { setDayType(''); setPeriod('') }}>Clear filters</button>
    </div> : null}
  </>
}

function ClassListRow({ result, active }: { result: ClassSearchResult; active: boolean }) {
  return <Link className={active ? 'class-list-row is-active' : 'class-list-row'} to={`/classes/${result.id}`}>
    <div className="class-list-copy"><strong>{result.course_name}</strong><span>{result.teacher_last_name}</span></div>
    <div className="class-list-meta"><span>{compactMeetingSlotLabels(result.meeting_slots).join(' · ')}</span><small>{classTermLabel(result.default_academic_term)}</small></div>
    <ChevronRight className="class-list-chevron" size={19} aria-hidden="true" />
  </Link>
}

function AuthenticatedClassesPage() {
  const { classId } = useParams()
  const { isDemo } = useAuth()
  const schedule = useSchedule()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [members, setMembers] = useState<ClassMemberResult[]>([])
  const [memberError, setMemberError] = useState<string | null>(null)
  const executeSearch = useMemo<ClassSearchExecutor>(() => isDemo
    ? async (input) => demoClasses.filter((item) => matchesFilters(item, input.query, input.dayType ?? '', input.period ?? ''))
    : searchClasses, [isDemo])
  const { error: searchError, loading, results } = useClassSearch({
    query,
    dayType: dayType || undefined,
    period: period || undefined,
    limit: 1000,
  }, { search: executeSearch })

  const ownClasses = useMemo(() => schedule.enrollments
    .filter((enrollment) => enrollment.active)
    .map(classResultFromEnrollment), [schedule.enrollments])
  const ownClassIds = useMemo(() => new Set(ownClasses.map((result) => result.id)), [ownClasses])
  const filteredOwnClasses = useMemo(() => ownClasses.filter((result) => matchesFilters(result, query, dayType, period)), [dayType, ownClasses, period, query])
  const otherClasses = useMemo(() => results.filter((result) => !ownClassIds.has(result.id)), [ownClassIds, results])
  const selected = useMemo(() => ownClasses.find((result) => result.id === classId)
    ?? results.find((result) => result.id === classId)
    ?? (isDemo ? demoClasses.find((result) => result.id === classId) : undefined), [classId, isDemo, ownClasses, results])
  const hasSchedule = ownClasses.length > 0

  useEffect(() => {
    setMembers([])
    setMemberError(null)
    if (!classId || !hasSchedule) return
    if (isDemo) {
      setMembers([
        { student_id: 'a', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', can_view_schedule: true },
        { student_id: 'b', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'classmates', can_view_schedule: true },
      ])
      return
    }
    void getClassMembers(classId).then(setMembers).catch((caught: unknown) => setMemberError(caught instanceof Error ? caught.message : 'Could not load class members.'))
  }, [classId, hasSchedule, isDemo])

  if (schedule.loading) return <LoadingScreen label="Loading your classes…" />

  return (
    <div className="classes-page">
      <header className="page-heading"><div><h1>View Classes</h1><p>Your active classes appear first. Search all remaining discoverable classes below.</p></div><Link className="button button-secondary desktop-report-action" to="/report" state={selected ? { reportedClass: selected } : undefined}><Flag size={17} /> {selected ? 'Report this class' : 'Report class info'}</Link></header>
      <ClassFilterControls dayType={dayType} filtersOpen={filtersOpen} period={period} query={query} setDayType={setDayType} setFiltersOpen={setFiltersOpen} setPeriod={setPeriod} setQuery={setQuery} />
      <Link className="mobile-report-action" to="/report" state={selected ? { reportedClass: selected } : undefined}><Flag size={15} aria-hidden="true" /> {selected ? 'Report this class' : 'Report class info'}</Link>
      {searchError ? <p className="form-error" role="alert">{searchError}</p> : null}
      {memberError ? <p className="form-error" role="alert">{memberError}</p> : null}
      <div className="class-browser">
        <section className="class-list-panel organized-class-list">
          {hasSchedule ? <section className="your-classes-section" aria-labelledby="your-classes-heading"><div><h2 id="your-classes-heading">Your Classes</h2><span>{ownClasses.length} active</span></div><p>Classes currently on your saved schedule.</p><div className="class-list">{filteredOwnClasses.map((result) => <ClassListRow active={classId === result.id} key={result.id} result={result} />)}{filteredOwnClasses.length === 0 ? <p className="empty-inline">None of your classes match these filters.</p> : null}</div></section> : <section className="your-classes-empty"><ImagePrompt /></section>}
          <section className="other-classes-section" aria-labelledby="other-classes-heading"><div><h2 id="other-classes-heading">Other Classes</h2><span>Discoverable sections</span></div><div className="class-list" aria-live="polite">{loading ? <p className="muted">Searching…</p> : otherClasses.map((result) => <ClassListRow active={classId === result.id} key={result.id} result={result} />)}{!loading && !searchError && otherClasses.length === 0 ? <p className="empty-inline">No other matching classes.</p> : null}</div></section>
        </section>
        {selected ? <Link className="mobile-class-detail-backdrop" to="/classes" aria-label="Close class details" /> : null}
        <section className={selected ? 'class-detail-panel is-open' : 'class-detail-panel'}>
          {selected ? <>
            <div className="sheet-handle" aria-hidden="true" />
            <Link className="mobile-class-detail-close icon-button" to="/classes" aria-label="Close class details"><X aria-hidden="true" /></Link>
            <div className="class-detail-heading"><div><h2>{selected.course_name}</h2><p>{selected.teacher_last_name}</p></div>{hasMultiplePeriodsOnAnyDay(selected.meeting_slots) ? <span className="status-tag">Multiple periods</span> : null}</div>
            <dl className="class-facts"><div><dt><CalendarDays size={18} /> Meeting slots</dt><dd>{formatMeetingSlotSummary(selected.meeting_slots)}</dd></div><div><dt>Default term</dt><dd>{selected.default_academic_term === 'full_year' ? 'Full Year' : selected.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</dd></div></dl>
            {ownClassIds.has(selected.id) ? <Link className="manage-class-link" to="/schedule">Manage this class on your schedule</Link> : null}
            {hasSchedule ? <><div className="member-heading"><h3><Users size={19} /> Students in this class</h3><span>{members.length}</span></div><div className="member-list">{members.map((member) => <div key={member.student_id} style={{ viewTransitionName: `student-${member.student_id}` }}><ProfileAvatar userId={member.student_id} fullName={member.full_name} /><div><strong>{member.full_name}</strong><small>Grade {member.grade}</small></div>{member.can_view_schedule ? <Link viewTransition to={`/students/${member.student_id}`}>View schedule</Link> : <span className="private-label">Schedule hidden</span>}</div>)}</div>{members.length === 0 ? <p className="empty-inline">No students in this class are visible under their privacy settings.</p> : null}</> : <section className="class-roster-locked"><LockKeyhole aria-hidden="true" /><p>Upload your schedule to see which classmates share your courses.</p><Link className="button button-primary" to="/schedule?import=1">Upload Schedule</Link></section>}
          </> : <div className="empty-state compact"><CalendarDays size={36} /><h2>Select a class</h2><p>Open a result to see its meeting slots and, when authorized, visible classmates.</p></div>}
        </section>
      </div>
    </div>
  )
}

function ImagePrompt() {
  return <><ImagePlusIcon /><div><h2>Your Classes</h2><p>You have not joined any classes yet. Upload your schedule to find and join your classes.</p></div><Link className="button button-primary" to="/schedule?import=1">Upload Schedule</Link></>
}

function ImagePlusIcon() {
  return <CalendarDays aria-hidden="true" />
}
