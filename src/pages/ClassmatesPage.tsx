import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscoveryGate } from '../components/auth/DiscoveryGate'
import { useAuth } from '../features/auth/AuthProvider'
import type { ClassmateResult } from '../lib/domain'
import { getClassmates } from '../lib/supabase/data'

const demoClassmates: ClassmateResult[] = [
  { student_id: '40000000-0000-4000-8000-000000000001', full_name: 'Alex Morgan', grade: 11, privacy_setting: 'classmates', shared_course_names: ['AP Language', 'Academic Chemistry', 'Honors Algebra 2'], can_view_schedule: true },
  { student_id: '40000000-0000-4000-8000-000000000003', full_name: 'Sam Rivera', grade: 10, privacy_setting: 'school', shared_course_names: ['Academic Chemistry'], can_view_schedule: true },
]

export function ClassmatesPage() {
  const { isDemo } = useAuth()
  const [classmates, setClassmates] = useState<ClassmateResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const request = isDemo ? Promise.resolve(demoClassmates) : getClassmates()
    void request.then(setClassmates).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load classmates.')).finally(() => setLoading(false))
  }, [isDemo])

  return (
    <DiscoveryGate>
      <div className="classmates-page">
        <header className="page-heading"><div><h1>Classmate Schedules</h1><p>People who share at least one active class with you. Each student’s privacy setting is applied automatically.</p></div></header>
        {loading ? <p className="muted">Loading classmates…</p> : null}
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        {!loading && !error && classmates.length === 0 ? <section className="empty-state"><Users size={36} /><h2>No classmates yet</h2><p>Add classes to find students who share them.</p><Link to="/schedule">Build my schedule</Link></section> : null}
        <div className="classmate-list">{classmates.map((classmate) => <article key={classmate.student_id}><span className="avatar">{classmate.full_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><h2>{classmate.full_name}</h2><p>Grade {classmate.grade}</p><div>{classmate.shared_course_names.map((name) => <span className="shared-class" key={name}>{name}</span>)}</div></div>{classmate.can_view_schedule ? <Link className="button button-secondary" to={`/students/${classmate.student_id}`}>View full schedule</Link> : <span className="private-label"><Users size={16} /> Shared classes only</span>}</article>)}</div>
      </div>
    </DiscoveryGate>
  )
}
