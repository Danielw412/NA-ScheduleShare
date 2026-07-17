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
        <h1>Upload your schedule to see which classmates share your courses.</h1>
        <p>ScheduleShare uses your own active classes to find relevant classmates without weakening anyone’s privacy setting.</p>
        <Link className="button button-primary" to="/schedule?import=1">Upload Schedule</Link>
      </section>
    )
  }
  return children
}
