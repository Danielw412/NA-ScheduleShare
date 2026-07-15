import { FileClock, Flag, GraduationCap, History, Merge, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { supabase } from '../lib/supabase/client'
import { adminListUsers, callAdminAction } from '../lib/supabase/data'

type AdminTab = 'users' | 'reports' | 'classes' | 'history' | 'admins' | 'audit'

const tabs: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'users', label: 'User management', icon: Users },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'classes', label: 'Class management', icon: GraduationCap },
  { id: 'history', label: 'Schedule history', icon: History },
  { id: 'admins', label: 'Admin management', icon: ShieldCheck },
  { id: 'audit', label: 'Audit logs', icon: FileClock },
]

const demoUsers = [
  { user_id: 'a', full_name: 'Jordan Smith', grade: 11, privacy_setting: 'classmates', status: 'active', is_admin: true, created_at: new Date().toISOString() },
  { user_id: 'b', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'private', status: 'active', is_admin: false, created_at: new Date().toISOString() },
  { user_id: 'c', full_name: 'Suspicious Account', grade: 9, privacy_setting: 'school', status: 'suspended', is_admin: false, created_at: new Date().toISOString() },
]

export function AdminPage() {
  const { isDemo } = useAuth()
  const [tab, setTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<Array<Record<string, unknown>>>(isDemo ? demoUsers : [])
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([])
  const [classes, setClasses] = useState<Array<Record<string, unknown>>>([])
  const [historyRows, setHistoryRows] = useState<Array<Record<string, unknown>>>([])
  const [auditRows, setAuditRows] = useState<Array<Record<string, unknown>>>([])
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canonicalId, setCanonicalId] = useState('')
  const [duplicateId, setDuplicateId] = useState('')
  const [adminUserId, setAdminUserId] = useState('')

  const load = useCallback(async () => {
    if (isDemo || !supabase) return
    try {
      const [nextUsers, reportResult, classResult, historyResult, auditResult] = await Promise.all([
        adminListUsers(query, grade || undefined, status || undefined),
        supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('classes').select('id, class_name, teacher_name, default_academic_term, is_double_period, status, created_at').order('class_name').limit(200),
        supabase.from('schedule_change_history').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      setUsers(nextUsers)
      if (reportResult.error) throw reportResult.error
      if (classResult.error) throw classResult.error
      if (historyResult.error) throw historyResult.error
      if (auditResult.error) throw auditResult.error
      setReports(reportResult.data as unknown as Array<Record<string, unknown>>)
      setClasses(classResult.data as unknown as Array<Record<string, unknown>>)
      setHistoryRows(historyResult.data as unknown as Array<Record<string, unknown>>)
      setAuditRows(auditResult.data as unknown as Array<Record<string, unknown>>)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load administrative data.')
    }
  }, [grade, isDemo, query, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(timer)
  }, [load])

  async function adminAction(name: string, args: Record<string, unknown>, success: string) {
    setError(null)
    try {
      if (!isDemo) await callAdminAction(name, args)
      setMessage(success)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Admin action failed.')
    }
  }

  function confirmDelete(user: Record<string, unknown>) {
    const expected = String(user.full_name)
    const typed = window.prompt(`Type “${expected}” to permanently delete this account. This revokes access and removes Auth data.`)
    if (typed !== expected) return
    void adminAction('admin_delete_user', { p_user_id: user.user_id, p_reason: 'Deleted from admin console' }, `${expected} was deleted.`)
  }

  return (
    <div className="admin-page">
      <header className="page-heading"><div><h1>Administration</h1><p>Protected user, class, report, schedule, role, and audit operations.</p></div><span className="admin-lock"><ShieldCheck /> Admin only</span></header>
      <div className="admin-tabs" role="tablist">{tabs.map((item) => { const Icon = item.icon; return <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => setTab(item.id)}><Icon size={17} /> {item.label}</button> })}</div>
      {message ? <div className="toast-message" role="status">{message}<button onClick={() => setMessage(null)}>×</button></div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
      {tab === 'users' ? <section className="admin-section">
        <div className="admin-toolbar"><input placeholder="Search users" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All grades</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div className="admin-table"><div className="admin-table-head"><span>User</span><span>Grade</span><span>Privacy</span><span>Status</span><span>Actions</span></div>{users.map((user) => <div className="admin-table-row" key={String(user.user_id)}><span><strong>{String(user.full_name)}</strong><small>{String(user.user_id)}</small></span><span>{String(user.grade)}</span><span>{String(user.privacy_setting)}</span><span className={`status-${String(user.status)}`}>{String(user.status)}</span><span className="row-actions">{user.status === 'suspended' ? <button onClick={() => void adminAction('admin_restore_user', { p_user_id: user.user_id, p_reason: 'Restored from admin console' }, 'User restored.')}>Restore</button> : <button onClick={() => { const reason = window.prompt('Suspension reason'); if (reason) void adminAction('admin_suspend_user', { p_user_id: user.user_id, p_reason: reason }, 'User suspended immediately.') }}>Suspend</button>}<button onClick={() => { const fullName = window.prompt('Corrected full name', String(user.full_name)); if (fullName) void adminAction('admin_update_user', { p_user_id: user.user_id, p_full_name: fullName, p_grade: user.grade, p_privacy_setting: user.privacy_setting, p_reason: 'Profile correction' }, 'Profile updated.') }}>Edit</button><button className="danger-text" onClick={() => confirmDelete(user)}>Delete</button></span></div>)}</div>
      </section> : null}
      {tab === 'reports' ? <section className="admin-section"><h2>Reports</h2><div className="admin-table"><div className="admin-table-head"><span>Category</span><span>Target</span><span>Status</span><span>Created</span><span>Actions</span></div>{reports.map((report) => <div className="admin-table-row" key={String(report.id)}><span>{String(report.reason_category)}</span><span>{String(report.reported_user_id ?? report.reported_class_id ?? 'General')}</span><span>{String(report.status)}</span><span>{new Date(String(report.created_at)).toLocaleDateString()}</span><span><button onClick={() => { const notes = window.prompt('Resolution notes'); if (notes) void adminAction('admin_resolve_report', { p_report_id: report.id, p_status: 'resolved', p_resolution_notes: notes }, 'Report resolved.') }}>Resolve</button></span></div>)}</div></section> : null}
      {tab === 'classes' ? <section className="admin-section"><div className="section-heading"><div><h2>Class management</h2><p>Rename or archive shared classes, then use the transactional merge tool for duplicates.</p></div></div><div className="merge-tool"><Merge /><label>Canonical class ID<input value={canonicalId} onChange={(event) => setCanonicalId(event.target.value)} /></label><label>Duplicate class ID<input value={duplicateId} onChange={(event) => setDuplicateId(event.target.value)} /></label><button className="button button-primary" disabled={!canonicalId || !duplicateId} onClick={() => { if (window.confirm('Move all enrollments and archive the duplicate class?')) void adminAction('admin_merge_classes', { p_canonical_class_id: canonicalId, p_duplicate_class_id: duplicateId, p_reason: 'Duplicate class merge' }, 'Classes merged transactionally.') }}>Merge classes</button></div><div className="admin-table"><div className="admin-table-head"><span>Class</span><span>Teacher</span><span>Term</span><span>Status</span><span>Actions</span></div>{classes.map((course) => <div className="admin-table-row" key={String(course.id)}><span><strong>{String(course.class_name)}</strong><small>{String(course.id)}</small></span><span>{String(course.teacher_name)}</span><span>{String(course.default_academic_term)}</span><span>{String(course.status)}</span><span><button className="danger-text" onClick={() => { if (window.confirm(`Archive ${String(course.class_name)}?`)) void adminAction('admin_archive_class', { p_class_id: course.id, p_reason: 'Archived from admin console' }, 'Class archived.') }}>Archive</button></span></div>)}</div></section> : null}
      {tab === 'history' ? <AdminLogTable title="Schedule history" rows={historyRows} primary="action" target="student_id" /> : null}
      {tab === 'audit' ? <AdminLogTable title="Immutable audit log" rows={auditRows} primary="action_type" target="target_id" /> : null}
      {tab === 'admins' ? <section className="admin-section narrow-admin"><h2>Admin management</h2><p>Role changes require an existing administrator. The last administrator cannot remove their own access.</p><label>User ID<input value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} /></label><div className="form-actions"><button className="button button-primary" disabled={!adminUserId} onClick={() => void adminAction('admin_promote_user', { p_user_id: adminUserId, p_reason: 'Promoted from admin console' }, 'Administrator access granted.')}>Promote to administrator</button><button className="button button-secondary danger-text" disabled={!adminUserId} onClick={() => void adminAction('admin_remove_user_role', { p_user_id: adminUserId, p_reason: 'Removed from admin console' }, 'Administrator access removed.')}>Remove administrator</button></div></section> : null}
    </div>
  )
}

function AdminLogTable({ title, rows, primary, target }: { title: string; rows: Array<Record<string, unknown>>; primary: string; target: string }) {
  return <section className="admin-section"><h2>{title}</h2><div className="admin-table"><div className="admin-table-head"><span>Action</span><span>Target</span><span>Actor</span><span>Timestamp</span><span>Details</span></div>{rows.map((row) => <div className="admin-table-row" key={String(row.id)}><span>{String(row[primary])}</span><span>{String(row[target] ?? '—')}</span><span>{String(row.administrator_id ?? row.changed_by ?? 'system')}</span><span>{new Date(String(row.created_at)).toLocaleString()}</span><span><code>{JSON.stringify(row.after_values ?? row.new_value ?? {})}</code></span></div>)}</div></section>
}
