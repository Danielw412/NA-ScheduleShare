import { Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { useAuth } from '../features/auth/AuthProvider'
import type { StudentDirectoryResult } from '../lib/domain'
import { searchStudentDirectory } from '../lib/supabase/data'

const demoStudents: StudentDirectoryResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'school', shared_class_count: 3, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000002', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'classmates', shared_class_count: 1, can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Casey Park', grade: 12, privacy_setting: 'school', shared_class_count: 0, can_view_schedule: true },
]

export function StudentsPage() {
  const { isDemo } = useAuth()
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [courseName, setCourseName] = useState('')
  const [teacherLastName, setTeacherLastName] = useState('')
  const [students, setStudents] = useState<StudentDirectoryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      const request = isDemo ? Promise.resolve(demoStudents.filter((student) => (!query || student.full_name.toLowerCase().includes(query.toLowerCase())) && (!grade || student.grade === grade))) : searchStudentDirectory({ query, grade: grade || undefined, courseName, teacherLastName })
      void request.then(setStudents).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Directory search failed.')).finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [courseName, grade, isDemo, query, teacherLastName])

  return (
    <DiscoveryGate>
      <div className="students-page">
        <header className="page-heading"><div><h1>Student Schedules</h1><p>Only students whose privacy setting permits discovery appear here.</p></div></header>
        <section className="directory-filters">
          <label className="search-input"><Search aria-hidden="true" /><span className="sr-only">Student name</span><input placeholder="Student name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>Grade</span><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Course</span><input placeholder="Any course" value={courseName} onChange={(event) => setCourseName(event.target.value)} /></label>
          <label><span>Teacher Last Name</span><input placeholder="Any teacher last name" value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} /></label>
          <SlidersHorizontal aria-hidden="true" />
        </section>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="directory-table" role="table" aria-label="Student schedules">
          <div className="directory-header" role="row"><span>Student</span><span>Grade</span><span>Shared classes</span><span>Privacy</span><span /></div>
          {loading ? <p className="muted">Loading schedules…</p> : students.map((student) => <div className="directory-row" role="row" key={student.student_id}><span><i className="avatar">{student.full_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</i><strong>{student.full_name}</strong></span><span>{student.grade}</span><span>{student.shared_class_count}</span><span className="privacy-value">{student.privacy_setting === 'school' ? 'School' : 'Classmates'}</span><span>{student.can_view_schedule ? <Link to={`/students/${student.student_id}`} state={{ reportedUser: { student_id: student.student_id, full_name: student.full_name, grade: student.grade } }}>View schedule</Link> : 'Unavailable'}</span></div>)}
          {!loading && students.length === 0 ? <p className="empty-inline">No viewable schedules match those filters.</p> : null}
        </div>
      </div>
    </DiscoveryGate>
  )
}
