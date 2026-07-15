import { CalendarDays, Flag, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { useAuth } from '../features/auth/AuthProvider'
import { useClassSearch, type ClassSearchExecutor } from '../hooks/useClassSearch'
import { demoEnrollments } from '../lib/demo-data'
import type { ClassMemberResult, ClassSearchResult, DayType } from '../lib/domain'
import { getClassMembers, searchClasses } from '../lib/supabase/data'

const demoClasses: ClassSearchResult[] = demoEnrollments.map((enrollment, index) => ({ ...enrollment.class, score: 100 - index }))

export function ClassesPage() {
  const { classId } = useParams()
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [period, setPeriod] = useState<number | ''>('')
  const [members, setMembers] = useState<ClassMemberResult[]>([])
  const [memberError, setMemberError] = useState<string | null>(null)
  const executeSearch = useMemo<ClassSearchExecutor>(() => isDemo
    ? async (input) => demoClasses.filter((item) => {
        const matchesQuery = `${item.class_name} ${item.teacher_name}`.toLowerCase().includes(input.query.toLowerCase())
        const matchesDay = !input.dayType || item.meeting_slots.some((slot) => slot.day_type === input.dayType)
        const matchesPeriod = !input.period || item.meeting_slots.some((slot) => slot.period_number === input.period)
        const matchesCell = !input.dayType || !input.period || item.meeting_slots.some((slot) => slot.day_type === input.dayType && slot.period_number === input.period)
        return matchesQuery && matchesDay && matchesPeriod && matchesCell
      })
    : searchClasses, [isDemo])
  const { error: searchError, loading, results } = useClassSearch({
    query,
    dayType: dayType || undefined,
    period: period || undefined,
  }, { search: executeSearch })
  const selected = useMemo(() => results.find((result) => result.id === classId) ?? demoClasses.find((result) => result.id === classId), [classId, results])

  useEffect(() => {
    if (!classId) return
    if (isDemo) {
      setMembers([
        { student_id: 'a', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', can_view_schedule: true },
        { student_id: 'b', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'private', can_view_schedule: false },
      ])
      return
    }
    setMemberError(null)
    void getClassMembers(classId).then(setMembers).catch((caught: unknown) => setMemberError(caught instanceof Error ? caught.message : 'Could not load class members.'))
  }, [classId, isDemo])

  return (
    <DiscoveryGate>
      <div className="classes-page">
        <header className="page-heading"><div><h1>View Classes</h1><p>Search shared class records by name, teacher, day, or period.</p></div><Link className="button button-secondary" to="/report"><Flag size={17} /> Report class info</Link></header>
        <div className="class-browser">
          <section className="class-list-panel">
            <div className="search-toolbar">
              <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Search classes</span><input placeholder="Class or teacher" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label><span className="sr-only">Day</span><select value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}><option value="">Any day</option><option value="A">A Day</option><option value="B">B Day</option></select></label>
              <label><span className="sr-only">Period</span><select value={period} onChange={(event) => setPeriod(event.target.value ? Number(event.target.value) : '')}><option value="">Any period</option>{Array.from({ length: 8 }, (_, index) => <option value={index + 1} key={index + 1}>Period {index + 1}</option>)}</select></label>
            </div>
            {searchError ? <p className="form-error" role="alert">{searchError}</p> : null}
            {memberError ? <p className="form-error" role="alert">{memberError}</p> : null}
            <div className="class-list" aria-live="polite">
              {loading ? <p className="muted">Searching…</p> : results.map((result) => (
                <Link className={classId === result.id ? 'class-list-row is-active' : 'class-list-row'} to={`/classes/${result.id}`} key={result.id}>
                  <div><strong>{result.class_name}</strong><span>{result.teacher_name}</span></div>
                  <div>{result.meeting_slots.map((slot) => <small key={`${slot.day_type}-${slot.period_number}`}>{slot.day_type} · P{slot.period_number}</small>)}</div>
                </Link>
              ))}
              {!loading && !searchError && results.length === 0 ? <p className="empty-inline">No matching classes.</p> : null}
            </div>
          </section>
          <section className="class-detail-panel">
            {selected ? (
              <>
                <div className="class-detail-heading"><div><h2>{selected.class_name}</h2><p>{selected.teacher_name}</p></div>{selected.is_double_period ? <span className="status-tag">Double period</span> : null}</div>
                <dl className="class-facts"><div><dt><CalendarDays size={18} /> Meeting slots</dt><dd>{selected.meeting_slots.map((slot) => `${slot.day_type} Day, Period ${slot.period_number}`).join(' · ')}</dd></div><div><dt>Default term</dt><dd>{selected.default_academic_term === 'full_year' ? 'Full Year' : selected.default_academic_term === 'semester_1' ? 'Semester 1' : 'Semester 2'}</dd></div></dl>
                <div className="member-heading"><h3><Users size={19} /> Students in this class</h3><span>{members.length}</span></div>
                <div className="member-list">{members.map((member) => <div key={member.student_id}><span className="avatar">{member.full_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><strong>{member.full_name}</strong><small>Grade {member.grade}</small></div>{member.can_view_schedule ? <Link to={`/students/${member.student_id}`}>View schedule</Link> : <span className="private-label">Shared class only</span>}</div>)}</div>
              </>
            ) : <div className="empty-state compact"><CalendarDays size={36} /><h2>Select a class</h2><p>Open a result to see its meeting slots and classmates.</p></div>}
          </section>
        </div>
      </div>
    </DiscoveryGate>
  )
}
