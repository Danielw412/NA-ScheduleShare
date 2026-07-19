import { ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import type { StudentDirectoryResult } from '../lib/domain'
import { searchStudentDirectory } from '../lib/supabase/data'

const demoStudents: StudentDirectoryResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 3, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000002', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'classmates', shared_class_count: 1, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Casey Park', grade: 12, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true },
]

export function StudentsPage() {
  return <DiscoveryGate><AuthenticatedStudentDirectory /></DiscoveryGate>
}

function AuthenticatedStudentDirectory() {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [courseName, setCourseName] = useState('')
  const [teacherLastName, setTeacherLastName] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [students, setStudents] = useState<StudentDirectoryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeFilterCount = Number(Boolean(grade)) + Number(Boolean(courseName.trim())) + Number(Boolean(teacherLastName.trim()))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      const request = isDemo
        ? Promise.resolve(demoStudents.filter((student) => (!query || student.full_name.toLowerCase().includes(query.toLowerCase())) && (!grade || student.grade === grade)))
        : searchStudentDirectory({ query, grade: grade || undefined, courseName, teacherLastName })
      void request.then(setStudents).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Directory search failed.')).finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [courseName, grade, isDemo, query, teacherLastName])

  function clearFilters() {
    setGrade('')
    setCourseName('')
    setTeacherLastName('')
  }

  return (
    <div className="students-page">
      <header className="page-heading"><div><h1>Student Schedules</h1><p>Only students whose privacy setting permits discovery appear here.</p></div></header>
      <section className="directory-filters">
        <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Student name</span><input placeholder="Student name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button aria-controls="student-mobile-filter-panel" aria-expanded={filtersOpen} className="mobile-filter-toggle" type="button" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={18} aria-hidden="true" /> Filters{activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}</button>
        <div className={filtersOpen ? 'mobile-filter-panel directory-filter-panel is-open' : 'mobile-filter-panel directory-filter-panel'} id="student-mobile-filter-panel">
          <label><span>Grade</span><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Course</span><input placeholder="Any course" value={courseName} onChange={(event) => setCourseName(event.target.value)} /></label>
          <label><span>Teacher Last Name</span><input placeholder="Any teacher last name" value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} /></label>
        </div>
      </section>
      {activeFilterCount > 0 ? <div className="mobile-active-filters" aria-label="Active student filters">
        {grade ? <button type="button" onClick={() => setGrade('')}>Grade {grade} <X size={14} aria-hidden="true" /></button> : null}
        {courseName.trim() ? <button type="button" onClick={() => setCourseName('')}>{courseName.trim()} <X size={14} aria-hidden="true" /></button> : null}
        {teacherLastName.trim() ? <button type="button" onClick={() => setTeacherLastName('')}>{teacherLastName.trim()} <X size={14} aria-hidden="true" /></button> : null}
        <button className="clear-filter-button" type="button" onClick={clearFilters}>Clear filters</button>
      </div> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="student-results" aria-label="Student schedules">
        {loading ? <p className="muted">Loading schedules…</p> : students.map((student) => {
          const privacyLabel = student.privacy_setting === 'school' ? 'Anyone' : student.privacy_setting === 'classmates' ? 'Classmates' : 'Private'
          const cardContent = <><ProfileAvatar userId={student.student_id} fullName={student.full_name} /><span className="student-result-copy"><strong>{student.full_name}</strong><span><span>Grade {student.grade}</span><span>{student.shared_class_count} shared {student.shared_class_count === 1 ? 'class' : 'classes'}</span><span className="privacy-value">{privacyLabel}</span></span></span>{student.can_view_schedule ? <ChevronRight size={20} aria-hidden="true" /> : <span className="student-result-unavailable">Unavailable</span>}</>
          return student.can_view_schedule
            ? <Link className="student-result-card" key={student.student_id} style={{ viewTransitionName: `student-${student.student_id}` }} viewTransition to={`/students/${student.student_id}`} state={{ reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade } }}>{cardContent}</Link>
            : <div aria-disabled="true" className="student-result-card is-disabled" key={student.student_id} style={{ viewTransitionName: `student-${student.student_id}` }}>{cardContent}</div>
        })}
        {!loading && students.length === 0 ? <p className="empty-inline">No viewable schedules match those filters.</p> : null}
      </div>
    </div>
  )
}
