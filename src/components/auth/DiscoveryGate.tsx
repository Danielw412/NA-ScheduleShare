import { LockKeyhole } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSchedule } from '../../hooks/useSchedule'
import { LoadingScreen } from '../ui/LoadingScreen'

export function DiscoveryGate({ children }: { children: React.ReactNode }) {
  const { enrollments, loading } = useSchedule()
  if (loading) return <LoadingScreen label="Checking your schedule…" />
  if (enrollments.length === 0) {
    return (
      <section className="empty-state discovery-lock">
        <LockKeyhole size={38} aria-hidden="true" />
        <h1>Add your first class to unlock discovery</h1>
        <p>Class and student discovery opens after you add at least one class to your own schedule.</p>
        <Link className="button button-primary" to="/schedule">Build my schedule</Link>
      </section>
    )
  }
  return children
}
