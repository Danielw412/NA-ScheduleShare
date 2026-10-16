import { Inbox, Search, Users } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { privacyLabels, type AdminReportRecord, type AdminUserRecord } from '../../lib/domain'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { AdminRowMenu, type AdminRowMenuEntry } from './AdminRowMenu'
import { AdminSectionHeading } from './AdminSectionHeading'
import { formatTimestamp, IdText, plural, TableSkeleton } from './adminShared'

/* Users, reports, and administrator roles. */

const reportReasonLabels: Record<AdminReportRecord['reason_category'], string> = {
  suspicious_user: 'Suspicious user',
  inappropriate_name: 'Inappropriate name',
  incorrect_class_information: 'Incorrect class information',
  duplicate_class: 'Duplicate classes',
  other: 'Other issue',
}

const reportStatus: Record<AdminReportRecord['status'], { label: string; badge: string }> = {
  open: { label: 'Open', badge: 'badge badge-info' },
  in_review: { label: 'In review', badge: 'badge badge-outline' },
  resolved: { label: 'Resolved', badge: 'badge badge-success' },
  dismissed: { label: 'Dismissed', badge: 'badge' },
}

const userStatus: Record<AdminUserRecord['status'], { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'badge' },
  suspended: { label: 'Suspended', badge: 'badge badge-danger' },
  deleted: { label: 'Deleted', badge: 'badge badge-outline' },
}

/* ---------- Users ---------- */

export function UsersSection({
  users,
  loaded,
  loading,
  query,
  grade,
  status,
  avatarRevision,
  onQuery,
  onGrade,
  onStatus,
  menuFor,
}: {
  users: AdminUserRecord[]
  loaded: boolean
  loading: boolean
  query: string
  grade: number | ''
  status: string
  avatarRevision: number
  onQuery: (value: string) => void
  onGrade: (value: number | '') => void
  onStatus: (value: string) => void
  menuFor: (user: AdminUserRecord) => AdminRowMenuEntry[]
}) {
  const filtered = Boolean(query || grade || status)
  return (
    <section className="admin-section" aria-labelledby="admin-users-title">
      <AdminSectionHeading
        id="admin-users-title"
        title="Users"
        count={loaded ? plural(users.length, 'account') : undefined}
        description="Find a student to correct their profile, suspend or restore access, or delete their account."
      />
      <div className="admin-toolbar" role="search">
        <div className="search-input admin-toolbar-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Search users by name" placeholder="Search by name" value={query} onChange={(event) => onQuery(event.target.value)} />
        </div>
        <select aria-label="Filter by grade" value={grade} onChange={(event) => onGrade(event.target.value ? Number(event.target.value) : '')}>
          <option value="">All grades</option>
          {[9, 10, 11, 12].map((value) => <option value={value} key={value}>Grade {value}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(event) => onStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {loading && loaded ? <span className="spinner is-small" role="status" aria-label="Updating results" /> : null}
      </div>

      {!loaded ? <TableSkeleton label="Loading users" /> : users.length === 0
        ? <EmptyState icon={Users} title={filtered ? 'No users match these filters' : 'No users yet'} action={filtered ? <button className="button button-secondary" type="button" onClick={() => { onQuery(''); onGrade(''); onStatus('') }}>Clear filters</button> : undefined}>
          {filtered ? 'Try a different name, grade, or status.' : 'Students appear here after they create an account.'}
        </EmptyState>
        : <div className="table-scroll admin-table-scroll">
          <table className="data-table admin-table admin-users-table" aria-busy={loading || undefined}>
            <thead>
              <tr><th scope="col">Student</th><th scope="col">Grade</th><th scope="col">Privacy</th><th scope="col">Status</th><th scope="col">Last online</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td className="admin-cell-primary">
                    <span className="admin-person">
                      <ProfileAvatar userId={user.user_id} fullName={user.full_name} revision={avatarRevision} className="is-small" />
                      <span className="admin-person-text">
                        <span className="admin-person-name"><strong>{user.full_name}</strong>{user.is_admin ? <span className="badge">Admin</span> : null}</span>
                        <IdText value={user.user_id} />
                      </span>
                    </span>
                  </td>
                  <td data-label="Grade" className="numeric">{user.grade ?? '—'}</td>
                  <td data-label="Privacy">{privacyLabels[user.privacy_setting]}</td>
                  <td data-label="Status"><span className={userStatus[user.status].badge}>{userStatus[user.status].label}</span></td>
                  <td data-label="Last online">
                    <span className="admin-stacked-text">
                      <span>{formatTimestamp(user.last_active_at)}</span>
                      <small>Last login {formatTimestamp(user.last_login_at, 'never')}</small>
                    </span>
                  </td>
                  <td className="admin-cell-actions"><AdminRowMenu label={`Actions for ${user.full_name}`} items={menuFor(user)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
    </section>
  )
}

/* ---------- Reports ---------- */

function reportTarget(report: AdminReportRecord): { name: string; kind: string } {
  return {
    name: report.reported_user_name ?? report.reported_course_name ?? 'General issue',
    kind: report.reported_user_id ? 'User' : report.reported_class_id || report.reported_course_name ? 'Class' : 'No target',
  }
}

export function ReportsSection({ reports, loaded, openCount, onReview }: { reports: AdminReportRecord[]; loaded: boolean; openCount: number; onReview: (id: string) => void }) {
  return (
    <section className="admin-section" aria-labelledby="admin-reports-title">
      <AdminSectionHeading
        id="admin-reports-title"
        title="Reports"
        count={loaded ? `${openCount.toLocaleString()} open` : undefined}
        description="Problems students reported about accounts and classes. Review each one and record what you did."
      />
      {!loaded ? <TableSkeleton label="Loading reports" /> : reports.length === 0
        ? <EmptyState icon={Inbox} title="No reports">When a student reports an account or class, it shows up here.</EmptyState>
        : <div className="table-scroll admin-table-scroll">
          <table className="data-table admin-table">
            <thead>
              <tr><th scope="col">Report</th><th scope="col">Reported by</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const target = reportTarget(report)
                return (
                  <tr key={report.report_id}>
                    <td className="admin-cell-primary">
                      <span className="admin-stacked-text">
                        <strong>{reportReasonLabels[report.reason_category]}</strong>
                        <small>{target.kind === 'No target' ? 'No account or class named' : `${target.kind}: ${target.name}`}</small>
                      </span>
                    </td>
                    <td data-label="Reported by">{report.reporter_name ?? 'Deleted user'}</td>
                    <td data-label="Submitted">{formatTimestamp(report.created_at)}</td>
                    <td data-label="Status"><span className={reportStatus[report.status].badge}>{reportStatus[report.status].label}</span></td>
                    <td className="admin-cell-actions">
                      <button className="button button-secondary button-sm" type="button" aria-label={`Review ${reportReasonLabels[report.reason_category].toLowerCase()} report about ${target.name}`} onClick={() => onReview(report.report_id)}>Review</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>}
    </section>
  )
}

export function ReportDialog({ report, onClose, onResolve }: { report: AdminReportRecord; onClose: () => void; onResolve: (notes: string, onError: (message: string) => void) => Promise<boolean> }) {
  const formId = useId()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = reportTarget(report)
  const resolvable = report.status !== 'resolved' && report.status !== 'dismissed'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!notes) return
    setSaving(true)
    setError(null)
    const resolved = await onResolve(notes, setError)
    setSaving(false)
    if (resolved) onClose()
  }

  return (
    <Dialog
      title={reportReasonLabels[report.reason_category]}
      description={`Report about ${target.name}`}
      onClose={onClose}
      dismissible={!saving}
      className="admin-dialog admin-report-dialog"
      footer={resolvable
        ? <>
          <button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>
          <button className="button button-primary" type="submit" form={formId} disabled={!notes || saving}>{saving ? 'Resolving…' : 'Mark resolved'}</button>
        </>
        : <button className="button button-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <dl className="facts admin-facts">
        <dt>Status</dt><dd><span className={reportStatus[report.status].badge}>{reportStatus[report.status].label}</span></dd>
        <dt>Reported</dt><dd>{target.name}{target.kind !== 'No target' ? <span className="muted"> ({target.kind.toLowerCase()})</span> : null}</dd>
        <dt>Submitted by</dt><dd>{report.reporter_name ?? 'Deleted user'}</dd>
        <dt>Submitted</dt><dd>{formatTimestamp(report.created_at)}</dd>
        {report.assigned_admin_name ? <><dt>Assigned to</dt><dd>{report.assigned_admin_name}</dd></> : null}
        {report.resolved_at ? <><dt>Resolved</dt><dd>{formatTimestamp(report.resolved_at)}</dd></> : null}
      </dl>
      <section className="admin-quote" aria-labelledby={`${formId}-description`}>
        <h3 id={`${formId}-description`}>What the student wrote</h3>
        <p>{report.explanation ?? 'No additional description was submitted.'}</p>
      </section>
      {report.resolution_notes ? <section className="admin-quote" aria-labelledby={`${formId}-resolution`}>
        <h3 id={`${formId}-resolution`}>Resolution notes</h3>
        <p>{report.resolution_notes}</p>
      </section> : null}
      {resolvable ? <form id={formId} className="field" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`${formId}-notes`}>Resolution notes</label>
        <textarea id={`${formId}-notes`} value={notes} maxLength={4000} disabled={saving} aria-describedby={`${formId}-help`} onChange={(event) => setNotes(event.target.value)} />
        <p className="field-help" id={`${formId}-help`}>Say what you changed or why no change was needed. Saved with the report.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form> : null}
    </Dialog>
  )
}

/* ---------- Administrators ---------- */

export function AdministratorsSection({ userId, onUserId, onPromote, onRemove }: { userId: string; onUserId: (value: string) => void; onPromote: () => void; onRemove: () => void }) {
  return (
    <section className="admin-section admin-narrow" aria-labelledby="admin-admins-title">
      <AdminSectionHeading
        id="admin-admins-title"
        title="Administrators"
        description="Grant or remove administrator access by user ID. Only an existing administrator can change roles, and the last administrator can’t remove their own access."
      />
      <div className="field">
        <label htmlFor="admin-role-user-id">User ID</label>
        <input id="admin-role-user-id" className="admin-mono-input" autoComplete="off" spellCheck={false} value={userId} aria-describedby="admin-role-user-id-help" onChange={(event) => onUserId(event.target.value)} />
        <p className="field-help" id="admin-role-user-id-help">Copy it from the actions menu next to a student in Users.</p>
      </div>
      <div className="form-actions">
        <button className="button button-primary" type="button" disabled={!userId} onClick={onPromote}>Make administrator</button>
        <button className="button button-secondary button-danger-outline" type="button" disabled={!userId} onClick={onRemove}>Remove administrator access</button>
      </div>
    </section>
  )
}
