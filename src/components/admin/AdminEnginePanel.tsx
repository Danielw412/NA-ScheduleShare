import { AlertCircle, Gauge, RefreshCw } from 'lucide-react'
import type { AdminScheduleEngineJob } from '../../lib/domain'
import { EmptyState } from '../ui/EmptyState'
import { AdminSectionHeading } from './AdminSectionHeading'
import { formatTimestamp, IdText, TableSkeleton } from './adminShared'

const engineStatus: Record<AdminScheduleEngineJob['status'], { label: string; badge: string }> = {
  queued: { label: 'Queued', badge: 'badge badge-outline' },
  processing: { label: 'Processing', badge: 'badge badge-info' },
  completed: { label: 'Completed', badge: 'badge badge-success' },
  failed: { label: 'Failed', badge: 'badge badge-danger' },
  cancelled: { label: 'Cancelled', badge: 'badge' },
}

const notificationLabels: Record<AdminScheduleEngineJob['notificationStatus'], string> = {
  not_requested: 'Not requested',
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
}

/* ---------- Schedule Engine ---------- */

function courseList(courses: Array<{ courseName: string }>): string {
  const names = courses.map((course) => course.courseName)
  if (names.length <= 1) return names[0] ?? 'nothing'
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function ScheduleEngineAdminPanel({ jobs, loaded, loading, onRefresh }: { jobs: AdminScheduleEngineJob[]; loaded: boolean; loading: boolean; onRefresh: () => void }) {
  const queued = jobs.filter((job) => job.status === 'queued')
  const processing = jobs.filter((job) => job.status === 'processing')
  return (
    <section className="admin-section" aria-labelledby="admin-engine-title">
      <AdminSectionHeading
        id="admin-engine-title"
        title="Schedule Engine queue"
        description="Requests students submitted and what the worker reported. Start and stop processing from the worker console on the operator’s laptop."
        actions={<button className="button button-secondary button-sm" type="button" disabled={loading} onClick={onRefresh}><RefreshCw aria-hidden="true" />Refresh</button>}
      />
      <dl className="admin-stats">
        <div><dt>Queued</dt><dd className="numeric">{queued.length}</dd></div>
        <div><dt>Processing</dt><dd className="numeric">{processing.length}</dd></div>
        <div><dt>Recent requests</dt><dd className="numeric">{jobs.length}</dd></div>
      </dl>
      {!loaded ? <TableSkeleton label="Loading Schedule Engine requests" /> : jobs.length === 0
        ? <EmptyState icon={Gauge} title="No Schedule Engine requests yet">Requests appear here as soon as a student submits one.</EmptyState>
        : <ul className="list admin-disclosure-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <details className="admin-disclosure" open={job.status === 'queued' || job.status === 'processing'}>
                <summary>
                  <span className={engineStatus[job.status].badge}>{engineStatus[job.status].label}</span>
                  <span className="admin-disclosure-title">
                    <strong>{job.userName}</strong>
                    <small>Replace {courseList(job.sourceCourses)} with {courseList(job.replacementCourses)}</small>
                  </span>
                  <span className="admin-disclosure-meta">{formatTimestamp(job.createdAt)}</span>
                </summary>
                <div className="admin-disclosure-body">
                  <dl className="facts admin-facts">
                    <dt>Request ID</dt><dd><IdText value={job.id} /></dd>
                    <dt>User ID</dt><dd><IdText value={job.userId} /></dd>
                    <dt>Worker</dt><dd>{job.workerId ?? 'Not claimed yet'}</dd>
                    <dt>Attempts</dt><dd className="numeric">{job.attemptCount}</dd>
                    <dt>Last heartbeat</dt><dd>{formatTimestamp(job.heartbeatAt)}</dd>
                    <dt>Email</dt><dd>{job.emailNotification ? notificationLabels[job.notificationStatus] : 'Not requested'}</dd>
                  </dl>
                  {job.errorMessage || job.notificationError ? <p className="form-error"><AlertCircle aria-hidden="true" />{job.errorMessage ?? job.notificationError}</p> : null}
                  {job.noValidScheduleReason ? <p className="notice notice-warning">No valid schedule: {job.noValidScheduleReason}</p> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>}
    </section>
  )
}
