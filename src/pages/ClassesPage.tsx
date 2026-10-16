import { AlertCircle, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Flag, ImageUp, LockKeyhole, RefreshCw, Search, Users } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { meetingSlotFacts, periodsLabel } from '../components/schedule/periodLabels'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { PageHeader } from '../components/ui/PageHeader'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../hooks/useClassSearch'
import { useNoIndex } from '../hooks/useNoIndex'
import { useSchedule } from '../hooks/useSchedule'
import { demoEnrollments } from '../lib/demo-data'
import type { ClassMemberResult, ClassSearchResult, DayType, MeetingSlot, ScheduleEnrollment } from '../lib/domain'
import { PERIOD_NUMBERS } from '../lib/schedule'
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

function firstSlot(result: ClassSearchResult): MeetingSlot | undefined {
  return [...result.meeting_slots].sort(
    (leftSlot, rightSlot) => leftSlot.period_number - rightSlot.period_number || leftSlot.day_type.localeCompare(rightSlot.day_type),
  )[0]
}

function compareBySchedulePosition(left: ClassSearchResult, right: ClassSearchResult): number {
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
  return 'Full year'
}

function isPlaceholderTeacher(teacher: string): boolean {
  return teacher.trim().toUpperCase() === 'N/A'
}

function uniquePeriods(result: ClassSearchResult): number[] {
  return [...new Set(result.meeting_slots.map((slot) => slot.period_number))].sort((left, right) => left - right)
}

/** Short facts that tell two sections of the same course apart in a list row. */
function rowFacts(result: ClassSearchResult): string[] {
  const facts: string[] = []
  const days = [...new Set(result.meeting_slots.map((slot) => slot.day_type))]
  if (days.length === 1) facts.push(`${days[0]} day`)
  const periods = uniquePeriods(result)
  if (periods.length > 1) facts.push(periodsLabel(periods))
  if (result.default_academic_term !== 'full_year') facts.push(classTermLabel(result.default_academic_term))
  return facts
}

export function ClassesPage() {
  const { user } = useAuth()
  useNoIndex(!user)
  return user ? <AuthenticatedClassesPage /> : <GuestClassesPage />
}

/* ---------- Layout: list and detail side by side, or one at a time on narrow screens ---------- */

interface ClassesLayoutProps {
  header: ReactNode
  master: ReactNode
  detail: ReactNode
  selectedKey: string | undefined
  headingRef: RefObject<HTMLHeadingElement | null>
  listScroll: RefObject<number | null>
}

function ClassesLayout({ header, master, detail, selectedKey, headingRef, listScroll }: ClassesLayoutProps) {
  const masterRef = useRef<HTMLDivElement | null>(null)
  const previousKey = useRef(selectedKey)
  const openedNarrow = useRef(false)

  // On narrow screens the list and the class replace each other, so a new
  // class starts at the top with focus on its name, and going back returns
  // to the spot in the list the student left, with focus on that class's row.
  useLayoutEffect(() => {
    const leftKey = previousKey.current
    if (leftKey === selectedKey) return
    previousKey.current = selectedKey
    const master = masterRef.current
    if (!master) return
    const listHidden = window.getComputedStyle(master).display === 'none'
    if (selectedKey && listHidden) {
      openedNarrow.current = true
      window.scrollTo({ top: 0 })
      headingRef.current?.focus({ preventScroll: true })
      return
    }
    if (selectedKey) return
    // The class (and the back link that may have had focus) just went away.
    const focusLost = !document.activeElement || document.activeElement === document.body
    if (!openedNarrow.current && !focusLost) return
    const restoreScroll = openedNarrow.current && listScroll.current !== null
    if (restoreScroll) window.scrollTo({ top: listScroll.current ?? 0 })
    openedNarrow.current = false
    listScroll.current = null
    const row = [...master.querySelectorAll<HTMLElement>('[data-view-key]')].find((element) => element.dataset.viewKey === leftKey)
    const fallback = document.getElementById('main-content')
    ;(row ?? fallback)?.focus({ preventScroll: restoreScroll || !row })
  }, [headingRef, listScroll, selectedKey])

  return (
    <div className={selectedKey ? 'page classes-page has-selection' : 'page classes-page'}>
      {header}
      <div className="classes-layout">
        <div className="classes-master" ref={masterRef}>{master}</div>
        <section className="classes-detail" aria-label="Class details">{detail}</section>
      </div>
    </div>
  )
}

/* ---------- Guest ---------- */

function GuestClassesPage() {
  const { classId } = useParams()
  const [searchParams] = useSearchParams()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const listScroll = useRef<number | null>(null)
  const { error, loading, results } = useClassSearch({
    query,
    dayType: dayType || undefined,
    period: period || undefined,
    limit: 1000,
  }, { search: searchGuestClasses })
  const classViews = useMemo(() => expandSearchResults(results)
    .filter((view) => matchesFilters(view.result, query, dayType, period)), [dayType, period, query, results])
  const selected = findSelectedView(classViews, classId, searchParams.get('day'), searchParams.get('period'))
  const rememberScroll = () => { listScroll.current = window.scrollY }

  return (
    <ClassesLayout
      selectedKey={selected?.key}
      headingRef={headingRef}
      listScroll={listScroll}
      header={<PageHeader title="Classes" description="Browse every class and when it meets. Create an account to see who’s in each one." />}
      master={<>
        <ClassFilters dayType={dayType} period={period} query={query} setDayType={setDayType} setPeriod={setPeriod} setQuery={setQuery} />
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <section className="section classes-group" aria-labelledby="classes-catalog-title">
          <div className="section-header">
            <h2 id="classes-catalog-title">All classes</h2>
            {!loading ? <span className="section-count">{courseCount(classViews)}</span> : null}
          </div>
          {loading && classViews.length === 0 ? <p className="classes-searching">Searching…</p> : <GroupedClassList activeViewKey={selected?.key} views={classViews} onNavigate={rememberScroll} />}
          {!loading && !error && classViews.length === 0 ? <p className="empty-inline">No classes match. Try another course or teacher, or clear the filters.</p> : null}
        </section>
      </>}
      detail={selected ? <ClassDetail
        selected={selected}
        meetingViews={classViews.filter((view) => view.result.id === selected.result.id && view.meeting?.period_number === selected.meeting?.period_number)}
        headingRef={headingRef}
      >
        <section className="classes-roster" aria-labelledby="classes-roster-title">
          <h3 id="classes-roster-title">Students in this class</h3>
          <div className="classes-locked">
            <LockKeyhole aria-hidden="true" />
            <p>Create an account and add your schedule to see who is in this class. Student privacy settings still apply.</p>
            <button className="button button-primary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button>
          </div>
        </section>
      </ClassDetail> : <EmptyState icon={BookOpen} title="Pick a class" centered>Choose a class to see when it meets. Create an account to see who’s in it.</EmptyState>}
    />
  )
}

function courseCount(views: ClassMeetingView[]): string {
  const count = new Set(views.map((view) => view.result.course_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase())).size
  return `${count} ${count === 1 ? 'course' : 'courses'}`
}

/* ---------- Filters ---------- */

interface ClassFiltersProps {
  query: string
  dayType: DayType | ''
  period: number | ''
  setQuery: (value: string) => void
  setDayType: (value: DayType | '') => void
  setPeriod: (value: number | '') => void
}

function ClassFilters({ query, dayType, period, setQuery, setDayType, setPeriod }: ClassFiltersProps) {
  const filtered = Boolean(dayType) || Boolean(period)
  return (
    <div className="classes-filters" role="search" aria-label="Find a class">
      <label className="search-input">
        <Search aria-hidden="true" />
        <span className="sr-only">Search classes</span>
        <input type="search" placeholder="Course or teacher" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="classes-filter-row">
        <label className="classes-select">
          <span className="sr-only">Day</span>
          <select value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}>
            <option value="">Any day</option>
            <option value="A">A day</option>
            <option value="B">B day</option>
          </select>
        </label>
        <label className="classes-select">
          <span className="sr-only">Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value ? Number(event.target.value) : '')}>
            <option value="">Any period</option>
            {PERIOD_NUMBERS.map((value) => <option value={value} key={value}>Period {value}</option>)}
          </select>
        </label>
        {filtered ? <button className="text-button classes-clear" type="button" onClick={() => { setDayType(''); setPeriod('') }}>Clear filters</button> : null}
      </div>
    </div>
  )
}

/* ---------- Lists ---------- */

/** Second line of a class row: the teacher, then chips for anything unusual about when it meets. */
function ItemMeta({ teacher, facts }: { teacher?: string | null; facts: string[] }) {
  if (!teacher && facts.length === 0) return null
  return (
    <span className="classes-item-meta">
      {teacher ? <span className="classes-item-teacher">{teacher}</span> : null}
      {facts.map((fact) => <span className="chip" key={fact}>{fact}</span>)}
    </span>
  )
}

function OwnClassList({ views, activeViewKey, onNavigate }: { views: ClassMeetingView[]; activeViewKey?: string; onNavigate: () => void }) {
  const groups = useMemo(() => {
    const byPeriod: Array<{ period: number; views: ClassMeetingView[] }> = []
    views.forEach((view) => {
      const period = firstSlot(view.result)?.period_number ?? 0
      const last = byPeriod[byPeriod.length - 1]
      if (last && last.period === period) last.views.push(view)
      else byPeriod.push({ period, views: [view] })
    })
    return byPeriod
  }, [views])

  return (
    <ol className="classes-periods">
      {groups.map((group) => (
        <li className="classes-period" key={group.period}>
          <span className="period-numeral"><span className="sr-only">Period </span>{group.period || '–'}</span>
          <ul className="classes-period-items">
            {group.views.map((view) => {
              const { result } = view
              const active = activeViewKey === view.key
              const teacher = isPlaceholderTeacher(result.teacher_last_name) ? null : result.teacher_last_name
              return (
                <li key={view.key}>
                  <Link className={active ? 'classes-item is-active' : 'classes-item'} to={classViewPath(view)} aria-current={active ? 'page' : undefined} data-view-key={view.key} onClick={onNavigate}>
                    <span className="classes-item-text">
                      <strong>{result.course_name}</strong>
                      <ItemMeta teacher={teacher} facts={rowFacts(result)} />
                    </span>
                    <ChevronRight className="classes-item-chevron" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function GroupedClassList({ views, activeViewKey, onNavigate }: { views: ClassMeetingView[]; activeViewKey?: string; onNavigate: () => void }) {
  const groups = useMemo(() => {
    const byName = new Map<string, { name: string; sections: ClassMeetingView[] }>()
    views.forEach((view) => {
      const { result } = view
      const key = result.course_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      const group = byName.get(key)
      if (group) group.sections.push(view)
      else byName.set(key, { name: result.course_name, sections: [view] })
    })
    return [...byName.entries()].map(([key, group]) => ({ key, ...group, sections: [...group.sections].sort(compareViewsBySchedulePosition) }))
  }, [views])
  const idPrefix = useId()
  const activeGroup = groups.find((group) => group.sections.some((section) => section.key === activeViewKey))?.key
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []))

  useEffect(() => {
    if (!activeGroup) return
    setExpanded((current) => current.has(activeGroup) ? current : new Set(current).add(activeGroup))
  }, [activeGroup])

  if (groups.length === 0) return null

  return (
    <ul className="classes-courses">
      {groups.map((group, index) => {
        const isExpanded = expanded.has(group.key)
        const sectionLabel = `${group.sections.length} ${group.sections.length === 1 ? 'period' : 'periods'}`
        const panelId = `${idPrefix}-course-${index}`
        return (
          <li className={isExpanded ? 'classes-course is-expanded' : 'classes-course'} key={group.key}>
            <button
              aria-controls={isExpanded ? panelId : undefined}
              aria-expanded={isExpanded}
              className="classes-course-toggle"
              type="button"
              onClick={() => setExpanded((current) => {
                const next = new Set(current)
                if (next.has(group.key)) next.delete(group.key)
                else next.add(group.key)
                return next
              })}
            >
              <span className="classes-course-text"><strong>{group.name}</strong><small>{sectionLabel}</small></span>
              <ChevronDown aria-hidden="true" />
            </button>
            {isExpanded ? (
              <ul className="classes-sections" id={panelId}>
                {group.sections.map((view) => {
                  const { result } = view
                  const active = activeViewKey === view.key
                  const periods = uniquePeriods(result)
                  const label = isPlaceholderTeacher(result.teacher_last_name) ? periodsLabel(periods) : result.teacher_last_name
                  return (
                    <li key={view.key}>
                      <Link className={active ? 'classes-item is-section is-active' : 'classes-item is-section'} to={classViewPath(view)} aria-current={active ? 'page' : undefined} data-view-key={view.key} onClick={onNavigate}>
                        <span className="period-numeral is-muted"><span className="sr-only">Period </span>{periods[0] ?? '–'}</span>
                        <span className="classes-item-text">
                          <strong>{label}</strong>
                          <ItemMeta facts={rowFacts(result)} />
                        </span>
                        <ChevronRight className="classes-item-chevron" aria-hidden="true" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Detail ---------- */

function ClassMeetingSwitch({ selected, views }: { selected: ClassMeetingView; views: ClassMeetingView[] }) {
  const dayViews = views.filter((view): view is ClassMeetingView & { meeting: MeetingSlot } => Boolean(view.meeting))
  if (dayViews.length < 2) return null
  return (
    <nav className="classes-meeting-switch" aria-label="Class meeting">
      {dayViews.map((view) => (
        <Link
          aria-current={view.key === selected.key ? 'page' : undefined}
          className={view.key === selected.key ? 'is-active' : undefined}
          key={view.key}
          to={classViewPath(view)}
        >{view.meeting.day_type} day</Link>
      ))}
    </nav>
  )
}

interface ClassDetailProps {
  selected: ClassMeetingView
  meetingViews: ClassMeetingView[]
  headingRef: RefObject<HTMLHeadingElement | null>
  owned?: boolean
  reportLink?: ReactNode
  children: ReactNode
}

function ClassDetail({ selected, meetingViews, headingRef, owned = false, reportLink, children }: ClassDetailProps) {
  const { result } = selected
  const teacher = isPlaceholderTeacher(result.teacher_last_name) ? null : result.teacher_last_name
  return (
    <article className="classes-detail-body" aria-labelledby="classes-detail-title">
      <div className="classes-detail-bar">
        <Link className="back-link classes-detail-back" to="/classes"><ChevronLeft aria-hidden="true" />All classes</Link>
      </div>
      <header className="classes-detail-header">
        <h2 id="classes-detail-title" ref={headingRef} tabIndex={-1}>{result.course_name}</h2>
        {teacher || owned ? (
          <div className="classes-detail-meta">
            {teacher ? <span>{teacher}</span> : null}
            {owned ? <span className="badge badge-gold">On your schedule</span> : null}
          </div>
        ) : null}
      </header>
      <ClassMeetingSwitch selected={selected} views={meetingViews} />
      <dl className="facts classes-facts">
        <dt>Meets</dt>
        <dd><span className="chip-list">{meetingSlotFacts(result.meeting_slots).map((fact) => <span className="chip" key={fact}>{fact}</span>)}</span></dd>
        <dt>Term</dt>
        <dd>{classTermLabel(result.default_academic_term)}</dd>
      </dl>
      {owned ? <Link className="inline-link classes-manage" to="/schedule">Manage this class on your schedule</Link> : null}
      {children}
      {reportLink}
    </article>
  )
}

interface RosterProps {
  members: ClassMemberResult[]
  loading: boolean
  error: string | null
  onRetry: () => void
}

function ClassRoster({ members, loading, error, onRetry }: RosterProps) {
  return (
    <section className="classes-roster" aria-labelledby="classes-roster-title">
      <div className="section-header">
        <h3 id="classes-roster-title">Students in this class</h3>
        {!loading && !error ? <span className="section-count">{members.length}</span> : null}
      </div>
      {loading ? (
        <div className="classes-roster-loading" role="status">
          <span className="sr-only">Loading students…</span>
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="notice notice-danger" role="alert">
          <AlertCircle aria-hidden="true" />
          <div><strong>Students didn’t load.</strong> {error}</div>
          <button className="button button-secondary button-sm" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</button>
        </div>
      ) : members.length === 0 ? (
        <p className="empty-inline">No other students are listed for this class yet.</p>
      ) : (
        <ul className="list classes-members">
          {members.map((member) => {
            const identity = <>
              <ProfileAvatar userId={member.student_id} fullName={member.full_name} />
              <span className="classes-member-text"><strong>{member.full_name}</strong><span>Grade {member.grade}</span></span>
            </>
            return (
              <li key={member.student_id} style={{ viewTransitionName: `student-${member.student_id}` }}>
                {member.can_view_schedule
                  ? <Link
                    className="classes-member is-link"
                    viewTransition
                    to={`/students/${member.student_id}`}
                    state={{ reportedUser: { student_id: member.student_id, full_name: member.full_name, grade: member.grade } }}
                  >
                    {identity}
                    <span className="classes-member-action">View schedule<ChevronRight aria-hidden="true" /></span>
                  </Link>
                  : <div className="classes-member">
                    {identity}
                    <span className="classes-member-private"><LockKeyhole aria-hidden="true" />Schedule hidden</span>
                  </div>}
              </li>
            )
          })}
        </ul>
      )}
      {!loading && !error ? <p className="classes-roster-note">Students only appear here when their privacy settings allow it.</p> : null}
    </section>
  )
}

/* ---------- Signed in ---------- */

function AuthenticatedClassesPage() {
  const { classId } = useParams()
  const [searchParams] = useSearchParams()
  const { isDemo } = useAuth()
  const schedule = useSchedule()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const [members, setMembers] = useState<ClassMemberResult[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [rosterAttempt, setRosterAttempt] = useState(0)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const listScroll = useRef<number | null>(null)
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
  const rememberScroll = () => { listScroll.current = window.scrollY }

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
  }, [hasSchedule, isDemo, rosterAttempt, selectedClassId, selectedMeetingDay, selectedMeetingPeriod])

  if (schedule.loading) return <LoadingScreen label="Loading your classes…" />

  const reportState = selected ? { reportedClass: selected.result } : undefined

  return (
    <ClassesLayout
      selectedKey={selected?.key}
      headingRef={headingRef}
      listScroll={listScroll}
      header={<PageHeader
        title="Classes"
        description="See who’s in your classes and browse every other class."
        actions={<Link className="button button-secondary" to="/report" state={reportState}><Flag aria-hidden="true" />{selected ? 'Report this class' : 'Report class info'}</Link>}
      />}
      master={<>
        <ClassFilters dayType={dayType} period={period} query={query} setDayType={setDayType} setPeriod={setPeriod} setQuery={setQuery} />
        {searchError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{searchError}</p> : null}
        {hasSchedule ? (
          <section className="section classes-group" aria-labelledby="classes-own-title">
            <div className="section-header">
              <h2 id="classes-own-title">Your classes</h2>
              <span className="section-count">{ownViews.length} {ownViews.length === 1 ? 'class' : 'classes'}</span>
            </div>
            {filteredOwnViews.length > 0
              ? <OwnClassList views={filteredOwnViews} activeViewKey={selected?.key} onNavigate={rememberScroll} />
              : <p className="empty-inline">None of your classes match these filters.</p>}
          </section>
        ) : (
          <div className="classes-group classes-own-empty">
            <EmptyState
              icon={ImageUp}
              title="Your classes show up here"
              headingLevel={2}
              action={<Link className="button button-primary" to="/schedule?import=1"><ImageUp aria-hidden="true" />Upload schedule</Link>}
            >You have not joined any classes yet. Upload your schedule to find and join your classes.</EmptyState>
          </div>
        )}
        <section className="section classes-group" aria-labelledby="classes-other-title">
          <div className="section-header">
            <div>
              <h2 id="classes-other-title">Other classes</h2>
              <p>Classes that aren’t on your schedule</p>
            </div>
            {!loading ? <span className="section-count">{courseCount(otherViews)}</span> : null}
          </div>
          {loading && otherViews.length === 0 ? <p className="classes-searching">Searching…</p> : <GroupedClassList activeViewKey={selected?.key} views={otherViews} onNavigate={rememberScroll} />}
          {!loading && !searchError && otherViews.length === 0
            ? <p className="empty-inline">{query.trim() || dayType || period ? 'No other classes match. Try another course or teacher, or clear the filters.' : 'Every class in the catalog is already on your schedule.'}</p>
            : null}
        </section>
      </>}
      detail={selected ? <ClassDetail
        selected={selected}
        meetingViews={meetingSwitchViews}
        headingRef={headingRef}
        owned={selectedIsOwned}
        reportLink={<Link className="text-button classes-detail-report" to="/report" state={reportState}><Flag aria-hidden="true" />Report this class</Link>}
      >
        {hasSchedule
          ? <ClassRoster members={members} loading={membersLoading} error={memberError} onRetry={() => setRosterAttempt((value) => value + 1)} />
          : <section className="classes-roster" aria-labelledby="classes-roster-title">
            <h3 id="classes-roster-title">Students in this class</h3>
            <div className="classes-locked">
              <LockKeyhole aria-hidden="true" />
              <p>Upload your schedule to see which classmates share your courses.</p>
              <Link className="button button-primary" to="/schedule?import=1"><ImageUp aria-hidden="true" />Upload schedule</Link>
            </div>
          </section>}
      </ClassDetail> : <EmptyState icon={Users} title="Pick a class" centered>Choose a class to see who’s in it. Students only appear when their privacy settings allow it.</EmptyState>}
    />
  )
}
