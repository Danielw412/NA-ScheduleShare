import { CalendarDays, ChevronDown, ChevronRight, Flag, LockKeyhole, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { useAuth } from '../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../hooks/useClassSearch'
import { useNoIndex } from '../hooks/useNoIndex'
import { useSchedule } from '../hooks/useSchedule'
import { demoEnrollments } from '../lib/demo-data'
import type { ClassMemberResult, ClassSearchResult, DayType, MeetingSlot, ScheduleEnrollment } from '../lib/domain'
import { compactMeetingSlotLabels, formatMeetingSlotSummary, hasMultiplePeriodsOnAnyDay, PERIOD_NUMBERS } from '../lib/schedule'
import { getClassMembers, searchClasses, searchGuestClasses } from '../lib/supabase/data'

const demoClasses: ClassSearchResult[] = demoEnrollments.map((enrollment, index) => ({ ...enrollment.class, score: 100 - index }))

interface ClassMeetingView {
  key: string
  result: ClassSearchResult
  meeting?: MeetingSlot
}

function isMeetingSpecific(result: ClassSearchResult): boolean {
  return result.course_term_policy === 'flexible_attendance'
}

function meetingView(result: ClassSearchResult, meeting?: MeetingSlot): ClassMeetingView {
  return {
    key: meeting ? `${result.id}:${meeting.day_type}:${meeting.period_number}` : result.id,
    result: meeting ? { ...result, meeting_slots: [meeting] } : result,
    meeting,
  }
}

function expandSearchResults(results: ClassSearchResult[]): ClassMeetingView[] {
  return results.flatMap((result) => {
    if (!isMeetingSpecific(result)) return [meetingView(result)]
    const periods = [...new Set(result.meeting_slots.map((slot) => slot.period_number))].sort((left, right) => left - right)
    return periods.flatMap((periodNumber) => (['A', 'B'] as DayType[]).map((dayType) => meetingView(result, {
      day_type: dayType,
      period_number: periodNumber,
    })))
  })
}

function viewsFromEnrollment(enrollment: ScheduleEnrollment): ClassMeetingView[] {
  const result = classResultFromEnrollment(enrollment)
  if (!isMeetingSpecific(result)) return [meetingView(result)]
  return (enrollment.meeting_slots ?? result.meeting_slots).map((slot) => meetingView(result, slot))
}

function classViewPath(view: ClassMeetingView): string {
  if (!view.meeting) return `/classes/${view.result.id}`
  return `/classes/${view.result.id}?day=${view.meeting.day_type}&period=${view.meeting.period_number}`
}

function findSelectedView(views: ClassMeetingView[], classId: string | undefined, day: string | null, period: string | null): ClassMeetingView | undefined {
  if (!classId) return undefined
  const requestedPeriod = period ? Number(period) : undefined
  return views.find((view) => view.result.id === classId
    && (!view.meeting || (view.meeting.day_type === day && view.meeting.period_number === requestedPeriod)))
    ?? views.find((view) => view.result.id === classId)
}

export function ClassesPage() {
  const { user } = useAuth()
  useNoIndex(!user)
  return user ? <AuthenticatedClassesPage /> : <GuestClassesPage />
}

function GuestClassesPage() {
  const { classId } = useParams()
  const [searchParams] = useSearchParams()
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
  const classViews = useMemo(() => expandSearchResults(results)
    .filter((view) => matchesFilters(view.result, query, dayType, period)), [dayType, period, query, results])
  const selected = findSelectedView(classViews, classId, searchParams.get('day'), searchParams.get('period'))

  return (
    <div className="classes-page guest-classes-page">
      <header className="page-heading"><div><h1>View Classes</h1><p>Create an account to see who is in each class.</p></div></header>
      <ClassFilterControls dayType={dayType} filtersOpen={filtersOpen} period={period} query={query} setDayType={setDayType} setFiltersOpen={setFiltersOpen} setPeriod={setPeriod} setQuery={setQuery} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="class-browser">
        <section className="class-list-panel organized-class-list">
          <section className="other-classes-section" aria-labelledby="guest-classes-heading">
            <div><h2 id="guest-classes-heading">Classes</h2><span>Current class catalog</span></div>
            <div className="class-list" aria-live="polite">
              {loading ? <p className="muted">Searching…</p> : <GroupedClassList activeViewKey={selected?.key} views={classViews} />}
              {!loading && !error && classViews.length === 0 ? <p className="empty-inline">No matching classes.</p> : null}
            </div>
          </section>
        </section>
        {selected ? <Link className="mobile-class-detail-backdrop" to="/classes" aria-label="Close class details" /> : null}
        <section className={selected ? 'class-detail-panel is-open' : 'class-detail-panel'}>
          {selected ? <>
            <div className="sheet-handle" aria-hidden="true" />
            <Link className="mobile-class-detail-close icon-button" to="/classes" aria-label="Close class details"><X aria-hidden="true" /></Link>
            <div className="class-detail-heading"><div><h2>{selected.result.course_name}</h2><p>{selected.result.teacher_last_name}</p></div>{hasMultiplePeriodsOnAnyDay(selected.result.meeting_slots) ? <span className="status-tag">Multiple periods</span> : null}</div>
            <ClassMeetingSwitch selected={selected} views={classViews.filter((view) => view.result.id === selected.result.id && view.meeting?.period_number === selected.meeting?.period_number)} />
            <dl className="class-facts"><div><dt><CalendarDays size={18} /> Meeting slots</dt><dd>{formatMeetingSlotSummary(selected.result.meeting_slots)}</dd></div><div><dt>Default term</dt><dd>{classTermLabel(selected.result.default_academic_term)}</dd></div></dl>
            <section className="class-roster-locked"><LockKeyhole aria-hidden="true" /><p>Create an account and add your schedule to see who is in this class. Student privacy settings still apply.</p><button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create Account</button></section>
          </> : <div className="empty-state compact"><CalendarDays size={36} /><h2>Select a class</h2><p>Create an account, then click a class to see who’s in it.</p></div>}
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
  return { ...enrollment.class, default_academic_term: enrollment.academic_term, score: 1000 }
}

function compareBySchedulePosition(left: ClassSearchResult, right: ClassSearchResult): number {
  const firstSlot = (result: ClassSearchResult) => [...result.meeting_slots].sort(
    (leftSlot, rightSlot) => leftSlot.period_number - rightSlot.period_number || leftSlot.day_type.localeCompare(rightSlot.day_type),
  )[0]
  const leftSlot = firstSlot(left)
  const rightSlot = firstSlot(right)
  return (leftSlot?.period_number ?? Number.MAX_SAFE_INTEGER) - (rightSlot?.period_number ?? Number.MAX_SAFE_INTEGER)
    || (leftSlot?.day_type ?? 'Z').localeCompare(rightSlot?.day_type ?? 'Z')
    || left.course_name.localeCompare(right.course_name)
}

function compareViewsBySchedulePosition(left: ClassMeetingView, right: ClassMeetingView): number {
  return compareBySchedulePosition(left.result, right.result)
}

function classTermLabel(term: ClassSearchResult['default_academic_term']): string {
  if (term === 'semester_1') return 'Semester 1'
  if (term === 'semester_2') return 'Semester 2'
  return 'Full Year'
}

function ClassMeetingSwitch({ selected, views }: { selected: ClassMeetingView; views: ClassMeetingView[] }) {
  const dayViews = views.filter((view): view is ClassMeetingView & { meeting: MeetingSlot } => Boolean(view.meeting))
  if (dayViews.length < 2) return null
  return <nav className="class-meeting-switch" aria-label="Class meeting">
    {dayViews.map((view) => <Link
      aria-current={view.key === selected.key ? 'page' : undefined}
      className={view.key === selected.key ? 'is-active' : ''}
      key={view.key}
      to={classViewPath(view)}
    >{view.meeting.day_type} Day</Link>)}
  </nav>
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
        <label><span className="sr-only">Day</span><select value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}><option value="">Any day</option><option value="A">A Day</option><option value="B">B Day</option></select></label>
        <label><span className="sr-only">Period</span><select value={period} onChange={(event) => setPeriod(event.target.value ? Number(event.target.value) : '')}><option value="">Any period</option>{PERIOD_NUMBERS.map((value) => <option value={value} key={value}>Period {value}</option>)}</select></label>
      </div>
    </div>
    {activeFilterCount > 0 ? <div className="mobile-active-filters" aria-label="Active class filters">
      {dayType ? <button type="button" onClick={() => setDayType('')}>{dayType} Day <X size={14} aria-hidden="true" /></button> : null}
      {period ? <button type="button" onClick={() => setPeriod('')}>Period {period} <X size={14} aria-hidden="true" /></button> : null}
      <button className="clear-filter-button" type="button" onClick={() => { setDayType(''); setPeriod('') }}>Clear filters</button>
    </div> : null}
  </>
}

function ClassListRow({ view, active, grouped = false }: { view: ClassMeetingView; active: boolean; grouped?: boolean }) {
  const { result } = view
  return <Link className={active ? 'class-list-row is-active' : 'class-list-row'} to={classViewPath(view)}>
    <div className="class-list-copy"><strong>{grouped ? result.teacher_last_name : result.course_name}</strong><span>{grouped ? 'Teacher' : result.teacher_last_name}</span></div>
    <div className="class-list-meta"><span>{compactMeetingSlotLabels(result.meeting_slots).join(' · ')}</span><small>{classTermLabel(result.default_academic_term)}</small></div>
    <ChevronRight className="class-list-chevron" size={19} aria-hidden="true" />
  </Link>
}

function GroupedClassList({ views, activeViewKey }: { views: ClassMeetingView[]; activeViewKey?: string }) {
  const groups = useMemo(() => {
    const byName = new Map<string, { name: string; sections: ClassMeetingView[] }>()
    views.forEach((view) => {
      const { result } = view
      const key = result.course_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      const group = byName.get(key)
      if (group) group.sections.push(view)
      else byName.set(key, { name: result.course_name, sections: [view] })
    })
    return [...byName.entries()].map(([key, group]) => ({ key, ...group }))
  }, [views])
  const activeGroup = groups.find((group) => group.sections.some((section) => section.key === activeViewKey))?.key
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []))

  useEffect(() => {
    if (!activeGroup) return
    setExpanded((current) => current.has(activeGroup) ? current : new Set(current).add(activeGroup))
  }, [activeGroup])

  return <>
    {groups.map((group) => {
      const isExpanded = expanded.has(group.key)
      const sectionLabel = `${group.sections.length} ${group.sections.length === 1 ? 'period' : 'periods'}`
      return <section className="course-class-group" key={group.key}>
        <button
          aria-expanded={isExpanded}
          className="course-class-group-toggle"
          type="button"
          onClick={() => setExpanded((current) => {
            const next = new Set(current)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })}
        >
          <span><strong>{group.name}</strong><small>{sectionLabel}</small></span>
          <ChevronDown className={isExpanded ? 'is-expanded' : ''} size={20} aria-hidden="true" />
        </button>
        {isExpanded ? <div className="course-class-group-sections">
          {group.sections.map((view) => <ClassListRow active={activeViewKey === view.key} grouped key={view.key} view={view} />)}
        </div> : null}
      </section>
    })}
  </>
}

function AuthenticatedClassesPage() {
  const { classId } = useParams()
  const [searchParams] = useSearchParams()
  const { isDemo } = useAuth()
  const schedule = useSchedule()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [members, setMembers] = useState<ClassMemberResult[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
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

  const ownViews = useMemo(() => schedule.enrollments
    .filter((enrollment) => enrollment.active)
    .flatMap(viewsFromEnrollment)
    .sort(compareViewsBySchedulePosition), [schedule.enrollments])
  const ownViewKeys = useMemo(() => new Set(ownViews.map((view) => view.key)), [ownViews])
  const filteredOwnViews = useMemo(() => ownViews.filter((view) => matchesFilters(view.result, query, dayType, period)), [dayType, ownViews, period, query])
  const searchViews = useMemo(() => expandSearchResults(results)
    .filter((view) => matchesFilters(view.result, query, dayType, period)), [dayType, period, query, results])
  const otherViews = useMemo(() => searchViews.filter((view) => !ownViewKeys.has(view.key)), [ownViewKeys, searchViews])
  const allViews = useMemo(() => {
    const byKey = new Map<string, ClassMeetingView>()
    ownViews.forEach((view) => byKey.set(view.key, view))
    searchViews.forEach((view) => { if (!byKey.has(view.key)) byKey.set(view.key, view) })
    if (isDemo) expandSearchResults(demoClasses).forEach((view) => { if (!byKey.has(view.key)) byKey.set(view.key, view) })
    return [...byKey.values()]
  }, [isDemo, ownViews, searchViews])
  const selected = findSelectedView(allViews, classId, searchParams.get('day'), searchParams.get('period'))
  const hasSchedule = ownViews.length > 0
  const selectedIsOwned = selected ? ownViewKeys.has(selected.key) : false
  const meetingSwitchViews = selected
    ? (selectedIsOwned ? ownViews : allViews).filter((view) => view.result.id === selected.result.id && view.meeting?.period_number === selected.meeting?.period_number)
    : []
  const selectedClassId = selected?.result.id
  const selectedMeetingDay = selected?.meeting?.day_type
  const selectedMeetingPeriod = selected?.meeting?.period_number

  useEffect(() => {
    let active = true
    setMembers([])
    setMembersLoading(false)
    setMemberError(null)
    if (!selectedClassId || !hasSchedule) return () => { active = false }
    if (isDemo) {
      setMembers([
        { student_id: 'a', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', can_view_schedule: true },
        { student_id: 'b', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'classmates', can_view_schedule: true },
      ])
      return () => { active = false }
    }
    setMembersLoading(true)
    void getClassMembers(selectedClassId, selectedMeetingDay && selectedMeetingPeriod ? {
      day_type: selectedMeetingDay,
      period_number: selectedMeetingPeriod,
    } : undefined)
      .then((nextMembers) => { if (active) setMembers(nextMembers) })
      .catch((caught: unknown) => { if (active) setMemberError(caught instanceof Error ? caught.message : 'Could not load class members.') })
      .finally(() => { if (active) setMembersLoading(false) })
    return () => { active = false }
  }, [hasSchedule, isDemo, selectedClassId, selectedMeetingDay, selectedMeetingPeriod])

  if (schedule.loading) return <LoadingScreen label="Loading your classes…" />

  return (
    <div className="classes-page">
      <header className="page-heading"><div><h1>View Classes</h1><p>See who's in your classes and browse other classes</p></div><Link className="button button-secondary desktop-report-action" to="/report" state={selected ? { reportedClass: selected.result } : undefined}><Flag size={17} /> {selected ? 'Report this class' : 'Report class info'}</Link></header>
      <ClassFilterControls dayType={dayType} filtersOpen={filtersOpen} period={period} query={query} setDayType={setDayType} setFiltersOpen={setFiltersOpen} setPeriod={setPeriod} setQuery={setQuery} />
      <Link className="mobile-report-action" to="/report" state={selected ? { reportedClass: selected.result } : undefined}><Flag size={15} aria-hidden="true" /> {selected ? 'Report this class' : 'Report class info'}</Link>
      {searchError ? <p className="form-error" role="alert">{searchError}</p> : null}
      {memberError ? <p className="form-error" role="alert">{memberError}</p> : null}
      <div className="class-browser">
        <section className="class-list-panel organized-class-list">
          {hasSchedule ? <section className="your-classes-section" aria-labelledby="your-classes-heading"><div><h2 id="your-classes-heading">Your Classes</h2><span>{ownViews.length} classes</span></div><p></p><div className="class-list">{filteredOwnViews.map((view) => <ClassListRow active={selected?.key === view.key} key={view.key} view={view} />)}{filteredOwnViews.length === 0 ? <p className="empty-inline">None of your classes match these filters.</p> : null}</div></section> : <section className="your-classes-empty"><ImagePrompt /></section>}
          <section className="other-classes-section" aria-labelledby="other-classes-heading"><div><h2 id="other-classes-heading">Other Classes</h2><span>Classes that aren't on your schedule</span></div><div className="class-list grouped-class-list" aria-live="polite">{loading ? <p className="muted">Searching…</p> : <GroupedClassList activeViewKey={selected?.key} views={otherViews} />}{!loading && !searchError && otherViews.length === 0 ? <p className="empty-inline">No other matching classes.</p> : null}</div></section>
        </section>
        {selected ? <Link className="mobile-class-detail-backdrop" to="/classes" aria-label="Close class details" /> : null}
        <section className={selected ? 'class-detail-panel is-open' : 'class-detail-panel'}>
          {selected ? <>
            <div className="sheet-handle" aria-hidden="true" />
            <Link className="mobile-class-detail-close icon-button" to="/classes" aria-label="Close class details"><X aria-hidden="true" /></Link>
            <div className="class-detail-heading"><div><h2>{selected.result.course_name}</h2><p>{selected.result.teacher_last_name}</p></div>{hasMultiplePeriodsOnAnyDay(selected.result.meeting_slots) ? <span className="status-tag">Multiple periods</span> : null}</div>
            <ClassMeetingSwitch selected={selected} views={meetingSwitchViews} />
            <dl className="class-facts"><div><dt><CalendarDays size={18} /> Meeting slots</dt><dd>{formatMeetingSlotSummary(selected.result.meeting_slots)}</dd></div><div><dt>Default term</dt><dd>{classTermLabel(selected.result.default_academic_term)}</dd></div></dl>
            {selectedIsOwned ? <Link className="manage-class-link" to="/schedule">Manage this class on your schedule</Link> : null}
            {hasSchedule ? <><div className="member-heading"><h3><Users size={19} /> Students in this class</h3><span>{membersLoading ? '…' : members.length}</span></div>{membersLoading ? <p className="muted" role="status">Loading students…</p> : <><div className="member-list">{members.map((member) => <div key={member.student_id} style={{ viewTransitionName: `student-${member.student_id}` }}><ProfileAvatar userId={member.student_id} fullName={member.full_name} /><div><strong>{member.full_name}</strong><small>Grade {member.grade}</small></div>{member.can_view_schedule ? <Link viewTransition to={`/students/${member.student_id}`}>View schedule</Link> : <span className="private-label">Schedule hidden</span>}</div>)}</div>{members.length === 0 && !memberError ? <p className="empty-inline">No students in this class are visible under their privacy settings.</p> : null}</>}</> : <section className="class-roster-locked"><LockKeyhole aria-hidden="true" /><p>Upload your schedule to see which classmates share your courses.</p><Link className="button button-primary" to="/schedule?import=1">Upload Schedule</Link></section>}
          </> : <div className="empty-state compact"><CalendarDays size={36} /><h2>Select a class</h2><p>Click on a class to see who's in it. Students with schedules set to private or classmates will not be shown. </p></div>}
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
