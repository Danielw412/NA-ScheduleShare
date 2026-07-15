import { FileClock, Flag, GraduationCap, History, Merge, ShieldCheck, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import type { AcademicTerm, AdminClassRecord, AdminReportRecord, DayType, MeetingSlot } from '../lib/domain'
import { PERIOD_NUMBERS, validateMeetingSlots } from '../lib/schedule'
import { supabase } from '../lib/supabase/client'
import { adminListClasses, adminListReports, adminListUsers, adminUpdateClass, callAdminAction } from '../lib/supabase/data'

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

const demoReports: AdminReportRecord[] = [{
  report_id: 'demo-report',
  reason_category: 'suspicious_user',
  explanation: 'This account repeatedly sent classmates misleading schedule information.',
  status: 'open',
  reporter_id: 'demo-reporter',
  reporter_name: 'Jordan Smith',
  reported_user_id: 'demo-target',
  reported_user_name: 'Suspicious Account',
  reported_class_id: null,
  reported_class_name: null,
  assigned_admin_id: null,
  assigned_admin_name: null,
  resolution_notes: null,
  created_at: new Date().toISOString(),
  resolved_at: null,
}]

const demoClasses: AdminClassRecord[] = [{
  id: 'demo-class',
  class_name: 'AP English Language',
  teacher_name: 'Ms. Carter',
  default_academic_term: 'full_year',
  is_double_period: false,
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  status: 'active',
  enrollment_count: 18,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}]

const reportReasonLabels: Record<AdminReportRecord['reason_category'], string> = {
  suspicious_user: 'Suspicious user',
  inappropriate_name: 'Inappropriate name',
  incorrect_class_information: 'Incorrect class information',
  duplicate_class: 'Duplicate classes',
  other: 'Other issue',
}

function classEditErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('class_edit_schedule_conflict')) return 'This edit would create a schedule conflict for at least one enrolled student. Choose different meeting slots.'
  if (message.includes('double_period_requires_two_consecutive_slots_per_day')) return 'Each selected day for a double-period class needs exactly two consecutive periods.'
  if (message.includes('single_period_requires_one_slot_per_day')) return 'A single-period class can have only one selected period on each meeting day.'
  if (message.includes('only_active_classes_can_be_edited')) return 'Only active classes can be edited.'
  return message || 'Class update failed.'
}

export function AdminPage() {
  const { isDemo } = useAuth()
  const [tab, setTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<Array<Record<string, unknown>>>(isDemo ? demoUsers : [])
  const [reports, setReports] = useState<AdminReportRecord[]>(isDemo ? demoReports : [])
  const [classes, setClasses] = useState<AdminClassRecord[]>(isDemo ? demoClasses : [])
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
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editingClass, setEditingClass] = useState<AdminClassRecord | null>(null)
  const [classSaving, setClassSaving] = useState(false)

  const load = useCallback(async () => {
    if (isDemo || !supabase) return
    try {
      const [nextUsers, nextReports, nextClasses, historyResult, auditResult] = await Promise.all([
        adminListUsers(query, grade || undefined, status || undefined),
        adminListReports(),
        adminListClasses(),
        supabase.from('schedule_change_history').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      if (historyResult.error) throw historyResult.error
      if (auditResult.error) throw auditResult.error
      setUsers(nextUsers)
      setReports(nextReports)
      setClasses(nextClasses)
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

  async function saveClass(input: {
    className: string
    teacherName: string
    term: AcademicTerm
    isDouble: boolean
    meetingSlots: MeetingSlot[]
    reason: string
  }) {
    if (!editingClass) return
    setClassSaving(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateClass({ classId: editingClass.id, ...input })
      setEditingClass(null)
      setMessage(`${input.className} was updated everywhere the shared class is used.`)
      await load()
    } catch (caught) {
      setError(classEditErrorMessage(caught))
    } finally {
      setClassSaving(false)
    }
  }

  function confirmDelete(user: Record<string, unknown>) {
    const expected = String(user.full_name)
    const typed = window.prompt(`Type “${expected}” to permanently delete this account. This revokes access and removes Auth data.`)
    if (typed !== expected) return
    void adminAction('admin_delete_user', { p_user_id: user.user_id, p_reason: 'Deleted from admin console' }, `${expected} was deleted.`)
  }

  const selectedReport = reports.find((report) => report.report_id === selectedReportId) ?? null

  return (
    <div className="admin-page">
      <header className="page-heading"><div><h1>Administration</h1><p>Protected user, class, report, schedule, role, and audit operations.</p></div><span className="admin-lock"><ShieldCheck /> Admin only</span></header>
      <div className="admin-tabs" role="tablist">{tabs.map((item) => { const Icon = item.icon; return <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => setTab(item.id)}><Icon size={17} /> {item.label}</button> })}</div>
      {message ? <div className="toast-message" role="status">{message}<button onClick={() => setMessage(null)}>×</button></div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}

      {tab === 'users' ? <section className="admin-section">
        <div className="admin-toolbar"><input placeholder="Search users" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All grades</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div className="admin-table"><div className="admin-table-head"><span>User</span><span>Grade</span><span>Privacy</span><span>Status</span><span>Actions</span></div>{users.map((user) => <div className="admin-table-row" key={String(user.user_id)}><span><strong>{String(user.full_name)}</strong><small>{String(user.user_id)}</small></span><span>{String(user.grade)}</span><span>{String(user.privacy_setting)}</span><span className={`status-${String(user.status)}`}>{String(user.status)}</span><span className="row-actions">{user.status === 'suspended' ? <button onClick={() => void adminAction('admin_restore_user', { p_user_id: user.user_id, p_reason: 'Restored from admin console' }, 'User restored.')}>Restore</button> : <button onClick={() => { const reasonText = window.prompt('Suspension reason'); if (reasonText) void adminAction('admin_suspend_user', { p_user_id: user.user_id, p_reason: reasonText }, 'User suspended immediately.') }}>Suspend</button>}<button onClick={() => { const fullName = window.prompt('Corrected full name', String(user.full_name)); if (fullName) void adminAction('admin_update_user', { p_user_id: user.user_id, p_full_name: fullName, p_grade: user.grade, p_privacy_setting: user.privacy_setting, p_reason: 'Profile correction' }, 'Profile updated.') }}>Edit</button><button className="danger-text" onClick={() => confirmDelete(user)}>Delete</button></span></div>)}</div>
      </section> : null}

      {tab === 'reports' ? <section className="admin-section"><h2>Reports</h2><div className="admin-table admin-report-table"><div className="admin-table-head"><span>Category</span><span>Reported account or class</span><span>Reporter</span><span>Status / submitted</span><span>Actions</span></div>{reports.map((report) => <div className="admin-table-row" key={report.report_id}><span><strong>{reportReasonLabels[report.reason_category]}</strong></span><span><strong>{report.reported_user_name ?? report.reported_class_name ?? 'General issue'}</strong><small>{report.reported_user_id ? 'User' : report.reported_class_id ? 'Class' : 'No target'}</small></span><span>{report.reporter_name ?? 'Deleted user'}</span><span><strong>{report.status.replace('_', ' ')}</strong><small>{new Date(report.created_at).toLocaleString()}</small></span><span className="row-actions"><button onClick={() => setSelectedReportId((current) => current === report.report_id ? null : report.report_id)}>{selectedReportId === report.report_id ? 'Hide details' : 'View details'}</button>{report.status === 'resolved' || report.status === 'dismissed' ? null : <button onClick={() => { const notes = window.prompt('Resolution notes'); if (notes) void adminAction('admin_resolve_report', { p_report_id: report.report_id, p_status: 'resolved', p_resolution_notes: notes }, 'Report resolved.') }}>Resolve</button>}</span></div>)}</div>{selectedReport ? <ReportDetails report={selectedReport} onClose={() => setSelectedReportId(null)} /> : null}</section> : null}

      {tab === 'classes' ? <section className="admin-section"><div className="section-heading"><div><h2>Class management</h2><p>Edit shared classes in place, archive obsolete records, or merge duplicates transactionally.</p></div></div><div className="merge-tool"><Merge /><label>Canonical class ID<input value={canonicalId} onChange={(event) => setCanonicalId(event.target.value)} /></label><label>Duplicate class ID<input value={duplicateId} onChange={(event) => setDuplicateId(event.target.value)} /></label><button className="button button-primary" disabled={!canonicalId || !duplicateId} onClick={() => { if (window.confirm('Move all enrollments and archive the duplicate class?')) void adminAction('admin_merge_classes', { p_canonical_class_id: canonicalId, p_duplicate_class_id: duplicateId, p_reason: 'Duplicate class merge' }, 'Classes merged transactionally.') }}>Merge classes</button></div><div className="admin-table admin-class-table"><div className="admin-table-head"><span>Class</span><span>Teacher / slots</span><span>Term</span><span>Status</span><span>Actions</span></div>{classes.map((course) => <div className="admin-table-row" key={course.id}><span><strong>{course.class_name}</strong><small>{course.id}</small></span><span><strong>{course.teacher_name}</strong><small>{course.meeting_slots.map((slot) => `${slot.day_type} P${slot.period_number}`).join(' · ')}</small></span><span>{course.default_academic_term.replace('_', ' ')}</span><span><strong>{course.status}</strong><small>{course.enrollment_count} active enrollment{course.enrollment_count === 1 ? '' : 's'}</small></span><span className="row-actions">{course.status === 'active' ? <button onClick={() => setEditingClass(course)}>Edit</button> : null}{course.status === 'active' ? <button className="danger-text" onClick={() => { if (window.confirm(`Archive ${course.class_name}?`)) void adminAction('admin_archive_class', { p_class_id: course.id, p_reason: 'Archived from admin console' }, 'Class archived.') }}>Archive</button> : null}</span></div>)}</div></section> : null}

      {tab === 'history' ? <AdminLogTable title="Schedule history" rows={historyRows} primary="action" target="student_id" /> : null}
      {tab === 'audit' ? <AdminLogTable title="Immutable audit log" rows={auditRows} primary="action_type" target="target_id" /> : null}
      {tab === 'admins' ? <section className="admin-section narrow-admin"><h2>Admin management</h2><p>Role changes require an existing administrator. The last administrator cannot remove their own access.</p><label>User ID<input value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} /></label><div className="form-actions"><button className="button button-primary" disabled={!adminUserId} onClick={() => void adminAction('admin_promote_user', { p_user_id: adminUserId, p_reason: 'Promoted from admin console' }, 'Administrator access granted.')}>Promote to administrator</button><button className="button button-secondary danger-text" disabled={!adminUserId} onClick={() => void adminAction('admin_remove_user_role', { p_user_id: adminUserId, p_reason: 'Removed from admin console' }, 'Administrator access removed.')}>Remove administrator</button></div></section> : null}

      {editingClass ? <AdminClassEditDialog key={editingClass.id} course={editingClass} saving={classSaving} onClose={() => setEditingClass(null)} onSave={saveClass} /> : null}
    </div>
  )
}

function ReportDetails({ report, onClose }: { report: AdminReportRecord; onClose: () => void }) {
  return <article className="report-detail-panel" aria-label="Report details"><header><div><span>Report details</span><h3>{reportReasonLabels[report.reason_category]}</h3></div><button className="icon-button" type="button" aria-label="Close report details" onClick={onClose}><X size={18} /></button></header><dl><div><dt>Reported</dt><dd>{report.reported_user_name ?? report.reported_class_name ?? 'General issue'}</dd></div><div><dt>Submitted by</dt><dd>{report.reporter_name ?? 'Deleted user'}</dd></div><div><dt>Submitted</dt><dd>{new Date(report.created_at).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{report.status.replace('_', ' ')}</dd></div>{report.assigned_admin_name ? <div><dt>Assigned admin</dt><dd>{report.assigned_admin_name}</dd></div> : null}{report.resolved_at ? <div><dt>Resolved</dt><dd>{new Date(report.resolved_at).toLocaleString()}</dd></div> : null}</dl><section><h4>Submitted description</h4><p>{report.explanation ?? 'No additional description was submitted.'}</p></section>{report.resolution_notes ? <section><h4>Resolution notes</h4><p>{report.resolution_notes}</p></section> : null}</article>
}

function AdminClassEditDialog({
  course,
  saving,
  onClose,
  onSave,
}: {
  course: AdminClassRecord
  saving: boolean
  onClose: () => void
  onSave: (input: { className: string; teacherName: string; term: AcademicTerm; isDouble: boolean; meetingSlots: MeetingSlot[]; reason: string }) => Promise<void>
}) {
  const [className, setClassName] = useState(course.class_name)
  const [teacherName, setTeacherName] = useState(course.teacher_name)
  const [term, setTerm] = useState<AcademicTerm>(course.default_academic_term)
  const [isDouble, setIsDouble] = useState(course.is_double_period)
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(course.meeting_slots)
  const [reason, setReason] = useState('Corrected from admin class management')
  const slotError = validateMeetingSlots(meetingSlots, isDouble)
  const canSave = className.trim().length >= 2 && teacherName.trim().length >= 2 && reason.trim().length >= 3 && !slotError

  function toggleSlot(slot: MeetingSlot) {
    setMeetingSlots((current) => current.some((item) => item.day_type === slot.day_type && item.period_number === slot.period_number)
      ? current.filter((item) => item.day_type !== slot.day_type || item.period_number !== slot.period_number)
      : [...current, slot].sort((left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    void onSave({ className, teacherName, term, isDouble, meetingSlots, reason })
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="class-dialog admin-class-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-class-title"><div className="sheet-handle" aria-hidden="true" /><header><div><h2 id="edit-class-title">Edit shared class</h2><p>{course.enrollment_count} active enrollment{course.enrollment_count === 1 ? '' : 's'} will receive this update.</p></div><button className="icon-button" type="button" aria-label="Close" disabled={saving} onClick={onClose}><X aria-hidden="true" /></button></header><form className="create-class-form" onSubmit={submit}><div className="two-field-row"><label>Class name<input required maxLength={120} value={className} onChange={(event) => setClassName(event.target.value)} /></label><label>Teacher<input required maxLength={120} value={teacherName} onChange={(event) => setTeacherName(event.target.value)} /></label></div><label>Academic term<select value={term} onChange={(event) => setTerm(event.target.value as AcademicTerm)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label><label className="checkbox-row"><input type="checkbox" checked={isDouble} onChange={(event) => setIsDouble(event.target.checked)} /><span><strong>Double-period class</strong><small>Each selected meeting day must use two consecutive periods.</small></span></label><fieldset className="slot-picker"><legend>A-day and B-day meeting slots</legend>{(['A', 'B'] as DayType[]).map((day) => <div key={day}><strong>{day} Day</strong>{PERIOD_NUMBERS.map((period) => <label key={period}><input type="checkbox" checked={meetingSlots.some((slot) => slot.day_type === day && slot.period_number === period)} onChange={() => toggleSlot({ day_type: day, period_number: period })} />P{period}</label>)}</div>)}</fieldset>{slotError ? <p className="form-error" role="alert">{slotError}</p> : null}<label>Audit reason<input required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save class changes'}</button></div></form></section></div>
}

function AdminLogTable({ title, rows, primary, target }: { title: string; rows: Array<Record<string, unknown>>; primary: string; target: string }) {
  return <section className="admin-section"><h2>{title}</h2><div className="admin-table"><div className="admin-table-head"><span>Action</span><span>Target</span><span>Actor</span><span>Timestamp</span><span>Details</span></div>{rows.map((row) => <div className="admin-table-row" key={String(row.id)}><span>{String(row[primary])}</span><span>{String(row[target] ?? '—')}</span><span>{String(row.administrator_id ?? row.changed_by ?? 'system')}</span><span>{new Date(String(row.created_at)).toLocaleString()}</span><span><code>{JSON.stringify(row.after_values ?? row.new_value ?? {})}</code></span></div>)}</div></section>
}
