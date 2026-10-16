import { ImageUp, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSchedule } from '../../hooks/useSchedule'
import { EmptyState } from '../ui/EmptyState'
import { LoadingScreen } from '../ui/LoadingScreen'
import { PageHeader } from '../ui/PageHeader'

/**
 * Classmate discovery uses the student's own classes, so it waits until they
 * have a schedule. The database enforces the same rule; this is only the UI.
 */
export function DiscoveryGate({ children }: { children: ReactNode }) {
  const { enrollments, loading } = useSchedule()
  if (loading) return <LoadingScreen label="Checking your schedule…" />
  if (enrollments.length === 0) {
    return (
      <div className="page students-page students-gate">
        <PageHeader title="Students" />
        <EmptyState
          icon={Users}
          title="Add your schedule to find classmates"
          action={<Link className="button button-primary" to="/schedule?import=1"><ImageUp aria-hidden="true" />Upload schedule</Link>}
        >
          ScheduleShare finds classmates using your own classes. Everyone’s privacy settings still apply.
        </EmptyState>
      </div>
    )
  }
  return children
}
