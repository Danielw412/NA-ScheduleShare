import { BarChart3, BrainCircuit, ChevronDown, ChevronRight, FileClock, Flag, GraduationCap, History, Merge, Plus, RefreshCw, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MeetingSlotEditor, preferredMeetingDay } from '../components/schedule/MeetingSlotEditor'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import { privacyLabels, type AcademicTerm, type AdminClassRecord, type AdminCourseNameRecord, type AdminReportRecord, type GeminiThinkingLevel, type HomepageActivityScope, type HomepageStatisticKey, type HomepageStatisticSettings, type MeetingSlot, type PrivacySetting, type ScheduleImportDiagnosticLog, type ScheduleImportModelRecord } from '../lib/domain'
import { buildNormalMeetingSlots, defaultDoubleMeetingSlots, formatMeetingSlotSummary, hasMultiplePeriodsOnAnyDay, meetingDaySelectionFromSlots, meetingPeriodFromSlots, type MeetingDaySelection, validateMeetingSlots } from '../lib/schedule'
import { supabase } from '../lib/supabase/client'
import { adminDeleteScheduleImportDiagnostic, adminGetHomepageStatisticSettings, adminListClasses, adminListCourseNames, adminListReports, adminListScheduleImportDiagnostics, adminListScheduleImportModels, adminListUsers, adminUpdateClass, adminUpdateHomepageStatisticSettings, adminUpdateScheduleImportProgressDuration, adminUpdateScheduleImportSettings, callAdminAction, getHomepageStatistic, getScheduleImportUiSettings } from '../lib/supabase/data'
import { teacherLastNameError } from '../lib/teacher'

type AdminTab = 'users' | 'reports' | 'classes' | 'homepage' | 'ai' | 'history' | 'admins' | 'audit'

const tabs: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'users', label: 'User management', icon: Users },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'classes', label: 'Class management', icon: GraduationCap },
  { id: 'homepage', label: 'Homepage', icon: BarChart3 },
  { id: 'ai', label: 'AI importer', icon: BrainCircuit },
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
  reported_course_name: null,
  assigned_admin_id: null,
  assigned_admin_name: null,
  resolution_notes: null,
  created_at: new Date().toISOString(),
  resolved_at: null,
}]

const demoClasses: AdminClassRecord[] = [{
  id: 'demo-class',
  course_name_id: 'demo-course',
  course_name: 'AP Language',
  teacher_last_name: 'Carter',
  default_academic_term: 'full_year',
  is_double_period: false,
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  status: 'active',
  active_enrollment_count: 18,
  total_enrollment_count: 19,
  report_count: 1,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}]

const demoCourseNames: AdminCourseNameRecord[] = [{
  id: 'demo-course',
  course_name: 'AP Language',
  status: 'active',
  source: 'approved',
  section_count: 1,
  active_section_count: 1,
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
  if (message.includes('meeting_slots_required')) return 'Select at least one meeting slot.'
  if (message.includes('only_active_classes_can_be_edited')) return 'Only active classes can be edited.'
  if (message.includes('active_course_name_not_found')) return 'Select an active course name from the catalog.'
  if (message.includes('invalid_teacher_last_name')) return 'Enter only a valid teacher last name without a title.'
  if (message.includes('normal_class_multiple_periods')) return 'Normal classes can use only one period on each selected day.'
  if (message.includes('double_period_slots_not_consecutive')) return 'Double-period slots must be consecutive on each selected day.'
  if (message.includes('double_period_requires_two_slots')) return 'Select two consecutive periods on at least one day for a double-period class.'
  if (message.includes('double_period_too_many_slots')) return 'A double-period class can use at most two periods on a day.'
  return message || 'Class update failed.'
}

function adminActionErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('class_not_found')) return 'That class section no longer exists. Refresh the class list and try again.'
  if (message.includes('not_admin') || message.includes('administrator')) return 'Administrator access is required for this action.'
  if (message.includes('foreign key') || message.includes('violates')) return 'The class section could not be deleted because a related record was not handled safely. No changes were kept; refresh and try again.'
  return message || 'Admin action failed.'
}

export function AdminPage() {
  const { isDemo } = useAuth()
  const [tab, setTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<Array<Record<string, unknown>>>(isDemo ? demoUsers : [])
  const [reports, setReports] = useState<AdminReportRecord[]>(isDemo ? demoReports : [])
  const [classes, setClasses] = useState<AdminClassRecord[]>(isDemo ? demoClasses : [])
  const [courseNames, setCourseNames] = useState<AdminCourseNameRecord[]>(isDemo ? demoCourseNames : [])
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
  const [courseFilter, setCourseFilter] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isDemo || !supabase) return
    try {
      const [nextUsers, nextReports, nextClasses, nextCourseNames, historyResult, auditResult] = await Promise.all([
        adminListUsers(query, grade || undefined, status || undefined),
        adminListReports(),
        adminListClasses(),
        adminListCourseNames(),
        supabase.from('schedule_change_history').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      if (historyResult.error) throw historyResult.error
      if (auditResult.error) throw auditResult.error
      setUsers(nextUsers)
      setReports(nextReports)
      setClasses(nextClasses)
      setCourseNames(nextCourseNames)
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
      setError(adminActionErrorMessage(caught))
    }
  }

  async function saveClass(input: {
    courseNameId: string
    teacherLastName: string
    term: AcademicTerm
    isDoublePeriod: boolean
    meetingSlots: MeetingSlot[]
    reason: string
  }) {
    if (!editingClass) return
    setClassSaving(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateClass({ classId: editingClass.id, ...input })
      setEditingClass(null)
      const courseName = courseNames.find((item) => item.id === input.courseNameId)?.course_name ?? 'The class section'
      setMessage(`${courseName} was updated everywhere this shared section is used.`)
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

  function permanentlyDeleteClass(course: AdminClassRecord) {
    const typed = window.prompt(
      `This permanently deletes ${course.course_name} with ${course.teacher_last_name}. ${course.total_enrollment_count} enrollment${course.total_enrollment_count === 1 ? '' : 's'} and ${course.meeting_slots.length} meeting slot${course.meeting_slots.length === 1 ? '' : 's'} will be deleted. ${course.report_count} report reference${course.report_count === 1 ? '' : 's'} will keep a course-name snapshot, and schedule/audit history will be retained. Type DELETE to continue.`,
    )
    if (typed?.trim() !== 'DELETE') return
    void adminAction('admin_delete_class_section', { p_class_id: course.id, p_reason: 'Permanently deleted from admin console' }, `${course.course_name} was permanently deleted.`)
  }

  function changeGrade(user: Record<string, unknown>) {
    const nextGrade = Number(window.prompt('Corrected grade (9-12)', String(user.grade)))
    if (![9, 10, 11, 12].includes(nextGrade)) {
      setError('Grade must be 9, 10, 11, or 12.')
      return
    }
    void adminAction('admin_update_user', {
      p_user_id: user.user_id,
      p_full_name: user.full_name,
      p_grade: nextGrade,
      p_privacy_setting: user.privacy_setting,
      p_reason: 'Administrator grade correction',
    }, 'Student grade updated.')
  }

  const selectedReport = reports.find((report) => report.report_id === selectedReportId) ?? null

  return (
    <div className="admin-page">
      <header className="page-heading"><div><h1>Administration</h1><p>Protected user, class, report, schedule, role, and audit operations.</p></div><span className="admin-lock"><ShieldCheck /> Admin only</span></header>
      <div className="admin-tabs" role="tablist">{tabs.map((item) => { const Icon = item.icon; return <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => setTab(item.id)}><Icon size={17} /> {item.label}</button> })}</div>
      {message ? <div className="toast-message" role="status">{message}<button onClick={() => setMessage(null)}>×</button></div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}

      {tab === 'users' ? <section className="admin-section">
        <div className="admin-toolbar"><input placeholder="Search users" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={grade} onChange={(event) => setGrade(event.target.value ? Number(event.target.value) : '')}><option value="">All grades</option>{[9, 10, 11, 12].map((value) => <option key={value}>{value}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div className="admin-table"><div className="admin-table-head"><span>User</span><span>Grade</span><span>Privacy</span><span>Status</span><span>Actions</span></div>{users.map((user) => <div className="admin-table-row" key={String(user.user_id)}><span className="admin-user-cell"><ProfileAvatar userId={String(user.user_id)} fullName={String(user.full_name)} /><span><strong>{String(user.full_name)}</strong><small>{String(user.user_id)}</small></span></span><span>{String(user.grade)}</span><span>{privacyLabels[String(user.privacy_setting) as PrivacySetting] ?? String(user.privacy_setting)}</span><span className={`status-${String(user.status)}`}>{String(user.status)}</span><span className="row-actions">{user.status === 'suspended' ? <button onClick={() => void adminAction('admin_restore_user', { p_user_id: user.user_id, p_reason: 'Restored from admin console' }, 'User restored.')}>Restore</button> : <button onClick={() => { const reasonText = window.prompt('Suspension reason'); if (reasonText) void adminAction('admin_suspend_user', { p_user_id: user.user_id, p_reason: reasonText }, 'User suspended immediately.') }}>Suspend</button>}<button onClick={() => { const fullName = window.prompt('Corrected full name', String(user.full_name)); if (fullName) void adminAction('admin_update_user', { p_user_id: user.user_id, p_full_name: fullName, p_grade: user.grade, p_privacy_setting: user.privacy_setting, p_reason: 'Profile name correction' }, 'Profile updated.') }}>Edit name</button><button onClick={() => changeGrade(user)}>Change grade</button><button className="danger-text" onClick={() => confirmDelete(user)}>Delete</button></span></div>)}</div>
      </section> : null}

      {tab === 'reports' ? <section className="admin-section"><h2>Reports</h2><div className="admin-table admin-report-table"><div className="admin-table-head"><span>Category</span><span>Reported account or class</span><span>Reporter</span><span>Status / submitted</span><span>Actions</span></div>{reports.map((report) => <div className="admin-table-row" key={report.report_id}><span><strong>{reportReasonLabels[report.reason_category]}</strong></span><span><strong>{report.reported_user_name ?? report.reported_course_name ?? 'General issue'}</strong><small>{report.reported_user_id ? 'User' : report.reported_class_id || report.reported_course_name ? 'Class' : 'No target'}</small></span><span>{report.reporter_name ?? 'Deleted user'}</span><span><strong>{report.status.replace('_', ' ')}</strong><small>{new Date(report.created_at).toLocaleString()}</small></span><span className="row-actions"><button onClick={() => setSelectedReportId((current) => current === report.report_id ? null : report.report_id)}>{selectedReportId === report.report_id ? 'Hide details' : 'View details'}</button>{report.status === 'resolved' || report.status === 'dismissed' ? null : <button onClick={() => { const notes = window.prompt('Resolution notes'); if (notes) void adminAction('admin_resolve_report', { p_report_id: report.report_id, p_status: 'resolved', p_resolution_notes: notes }, 'Report resolved.') }}>Resolve</button>}</span></div>)}</div>{selectedReport ? <ReportDetails report={selectedReport} onClose={() => setSelectedReportId(null)} /> : null}</section> : null}

      {tab === 'classes' ? <ClassManagementPanel
        classes={classes}
        courseNames={courseNames}
        courseFilter={courseFilter}
        canonicalId={canonicalId}
        duplicateId={duplicateId}
        onCourseFilter={setCourseFilter}
        onCanonicalId={setCanonicalId}
        onDuplicateId={setDuplicateId}
        onEdit={setEditingClass}
        onPermanentDelete={permanentlyDeleteClass}
        onAdminAction={adminAction}
      /> : null}

      {tab === 'homepage' ? <HomepageStatisticPanel isDemo={isDemo} /> : null}

      {tab === 'ai' ? <AiImporterManagementPanel isDemo={isDemo} /> : null}

      {tab === 'history' ? <AdminLogTable title="Schedule history" rows={historyRows} primary="action" target="student_id" /> : null}
      {tab === 'audit' ? <AdminLogTable title="Immutable audit log" rows={auditRows} primary="action_type" target="target_id" /> : null}
      {tab === 'admins' ? <section className="admin-section narrow-admin"><h2>Admin management</h2><p>Role changes require an existing administrator. The last administrator cannot remove their own access.</p><label>User ID<input value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} /></label><div className="form-actions"><button className="button button-primary" disabled={!adminUserId} onClick={() => void adminAction('admin_promote_user', { p_user_id: adminUserId, p_reason: 'Promoted from admin console' }, 'Administrator access granted.')}>Promote to administrator</button><button className="button button-secondary danger-text" disabled={!adminUserId} onClick={() => void adminAction('admin_remove_user_role', { p_user_id: adminUserId, p_reason: 'Removed from admin console' }, 'Administrator access removed.')}>Remove administrator</button></div></section> : null}

      {editingClass ? <AdminClassEditDialog key={editingClass.id} course={editingClass} courseNames={courseNames} saving={classSaving} onClose={() => setEditingClass(null)} onSave={saveClass} /> : null}
    </div>
  )
}

const defaultHomepageSettings: HomepageStatisticSettings = {
  shown: false,
  statistic_key: 'students_joined',
  minimum_value: 25,
  activity_scope: 'total',
  updated_at: '',
}

const homepageStatisticLabels: Record<HomepageStatisticKey, string> = {
  students_joined: 'NA students joined',
  schedules_uploaded: 'Schedules uploaded',
  class_connections: 'Class connections found',
}

export function HomepageStatisticPanel({ isDemo }: { isDemo: boolean }) {
  const [settings, setSettings] = useState<HomepageStatisticSettings>(defaultHomepageSettings)
  const [realValue, setRealValue] = useState<{ value: number; label: string } | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isDemo) return
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, statistic] = await Promise.all([
        adminGetHomepageStatisticSettings(),
        getHomepageStatistic(),
      ])
      setSettings(nextSettings)
      setRealValue(statistic ? { value: statistic.statistic_value, label: statistic.statistic_label } : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load homepage statistic settings.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (!isDemo) await adminUpdateHomepageStatisticSettings({
        shown: settings.shown,
        statistic_key: settings.statistic_key,
        minimum_value: settings.minimum_value,
        activity_scope: settings.activity_scope,
      })
      setMessage('Homepage statistic settings saved. The displayed number remains database-calculated.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save homepage statistic settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="admin-section"><p className="muted">Loading homepage settings…</p></section>
  return <section className="admin-section homepage-stat-settings">
    <div><h2>Homepage social proof</h2><p>Choose which aggregate appears and when. The number is always calculated from real database activity and cannot be entered manually.</p></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {message ? <p className="form-success" role="status">{message}</p> : null}
    <form onSubmit={(event) => void save(event)}>
      <label className="checkbox-row"><input type="checkbox" checked={settings.shown} onChange={(event) => setSettings((current) => ({ ...current, shown: event.target.checked }))} /><span><strong>Show homepage statistic</strong><small>It still stays hidden while the real value is below the minimum.</small></span></label>
      <label>Statistic<select value={settings.statistic_key} onChange={(event) => setSettings((current) => ({ ...current, statistic_key: event.target.value as HomepageStatisticKey }))}>{(Object.entries(homepageStatisticLabels) as Array<[HomepageStatisticKey, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Minimum real value<input min={0} max={1000000000} step={1} type="number" value={settings.minimum_value} onChange={(event) => setSettings((current) => ({ ...current, minimum_value: Math.max(0, Number(event.target.value)) }))} /></label>
      <label>Activity window<select value={settings.activity_scope} onChange={(event) => setSettings((current) => ({ ...current, activity_scope: event.target.value as HomepageActivityScope }))}><option value="total">Total activity</option><option value="recent">Recent activity (last 30 days)</option></select></label>
      <div className="homepage-stat-preview"><span>Current public result</span>{realValue ? <strong>{new Intl.NumberFormat().format(realValue.value)} {realValue.label}</strong> : <strong>Hidden by the current setting or minimum</strong>}</div>
      <button className="button button-primary" disabled={saving || isDemo}>{saving ? 'Saving…' : 'Save homepage settings'}</button>
      {isDemo ? <small className="muted">Connect Supabase to save or preview real statistics.</small> : null}
    </form>
  </section>
}

const demoImportModels: ScheduleImportModelRecord[] = [
  {
    model_id: 'gemini-3.5-flash-lite',
    display_name: 'Gemini 3.5 Flash-Lite',
    enabled: true,
    supports_image_input: true,
    supports_structured_output: true,
    supported_thinking_levels: ['minimal', 'low', 'medium', 'high'],
    max_output_tokens: 65536,
    is_active: true,
    production_thinking_level: 'low',
    production_output_token_limit: 4096,
  },
  {
    model_id: 'gemini-3.5-flash',
    display_name: 'Gemini 3.5 Flash',
    enabled: true,
    supports_image_input: true,
    supports_structured_output: true,
    supported_thinking_levels: ['minimal', 'low', 'medium', 'high'],
    max_output_tokens: 65536,
    is_active: false,
    production_thinking_level: 'low',
    production_output_token_limit: 4096,
  },
]

function AiImporterManagementPanel({ isDemo }: { isDemo: boolean }) {
  const [models, setModels] = useState<ScheduleImportModelRecord[]>(isDemo ? demoImportModels : [])
  const [logs, setLogs] = useState<ScheduleImportDiagnosticLog[]>([])
  const [modelId, setModelId] = useState(isDemo ? demoImportModels[0].model_id : '')
  const [thinkingLevel, setThinkingLevel] = useState<GeminiThinkingLevel>('low')
  const [outputTokenLimit, setOutputTokenLimit] = useState(4096)
  const [progressDurationSeconds, setProgressDurationSeconds] = useState(6.5)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isDemo) return
    setLoading(true)
    setError(null)
    try {
      const [nextModels, nextLogs, uiSettings] = await Promise.all([
        adminListScheduleImportModels(),
        adminListScheduleImportDiagnostics(),
        getScheduleImportUiSettings(),
      ])
      setModels(nextModels)
      setLogs(nextLogs)
      const active = nextModels.find((model) => model.is_active) ?? nextModels[0]
      setModelId(active?.model_id ?? '')
      setThinkingLevel(active?.production_thinking_level ?? 'low')
      setOutputTokenLimit(active?.production_output_token_limit ?? 4096)
      setProgressDurationSeconds(uiSettings.progress_bar_duration_ms / 1000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load AI importer settings.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const selectedModel = models.find((model) => model.model_id === modelId) ?? null
  const canSave = selectedModel !== null
    && selectedModel.enabled
    && selectedModel.supports_image_input
    && selectedModel.supports_structured_output
    && selectedModel.supported_thinking_levels.includes(thinkingLevel)
    && Number.isInteger(outputTokenLimit)
    && outputTokenLimit >= 256
    && outputTokenLimit <= Math.min(8192, selectedModel.max_output_tokens)
    && Number.isFinite(progressDurationSeconds)
    && progressDurationSeconds >= 1
    && progressDurationSeconds <= 30

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (!isDemo) await Promise.all([
        adminUpdateScheduleImportSettings({ modelId, thinkingLevel, outputTokenLimit }),
        adminUpdateScheduleImportProgressDuration(Math.round(progressDurationSeconds * 1000)),
      ])
      setMessage('Production Gemini and progress-bar settings updated. New imports will use them immediately.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the AI importer settings.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteLog(log: ScheduleImportDiagnosticLog) {
    if (!window.confirm('Delete this temporary diagnostic log now? The deletion is recorded in the immutable audit log.')) return
    setError(null)
    try {
      if (!isDemo) await adminDeleteScheduleImportDiagnostic(log.diagnostic_id)
      setLogs((current) => current.filter((candidate) => candidate.diagnostic_id !== log.diagnostic_id))
      setMessage('Diagnostic log deleted and the access was audited.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the diagnostic log.')
    }
  }

  return <section className="admin-section ai-importer-admin">
    <div className="section-heading"><div><h2>Gemini schedule importer</h2><p>Only allowlisted, image-capable structured-output models can be selected. Changes apply without a frontend or Edge Function deployment.</p></div><button className="button button-secondary" disabled={loading} type="button" onClick={() => void load()}><RefreshCw size={16} /> Refresh</button></div>
    {message ? <div className="notice-box"><span>{message}</span></div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <form className="ai-model-settings" onSubmit={saveSettings}>
      <label>Production model<select value={modelId} disabled={loading || saving} onChange={(event) => {
        const model = models.find((candidate) => candidate.model_id === event.target.value)
        setModelId(event.target.value)
        if (model && !model.supported_thinking_levels.includes(thinkingLevel)) {
          setThinkingLevel(model.supported_thinking_levels.includes('low') ? 'low' : model.supported_thinking_levels[0] ?? 'low')
        }
      }}>{models.map((model) => <option key={model.model_id} value={model.model_id} disabled={!model.enabled || !model.supports_image_input || !model.supports_structured_output}>{model.display_name}{model.enabled ? '' : ' (disabled)'}</option>)}</select></label>
      <label>Thinking level<select value={thinkingLevel} disabled={!selectedModel || saving} onChange={(event) => setThinkingLevel(event.target.value as GeminiThinkingLevel)}>{(selectedModel?.supported_thinking_levels ?? []).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      <label>Output-token limit<input type="number" min={256} max={Math.min(8192, selectedModel?.max_output_tokens ?? 8192)} step={128} value={outputTokenLimit} disabled={saving} onChange={(event) => setOutputTokenLimit(Number(event.target.value))} /></label>
      <label>Progress duration (seconds)<input type="number" min={1} max={30} step={0.5} value={progressDurationSeconds} disabled={saving} onChange={(event) => setProgressDurationSeconds(Number(event.target.value))} /></label>
      <button className="button button-primary" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Update production configuration'}</button>
    </form>
    <div className="notice-box"><BrainCircuit aria-hidden="true" /><span><strong>Developer mode stays off by default.</strong> An administrator must enable it inside the screenshot importer for the current dialog session. It bypasses only ScheduleShare's database rate limit; authentication, file validation, model allowlisting, Gemini quotas, and all other checks remain enforced.</span></div>

    <div className="section-heading diagnostic-heading"><div><h3>Temporary diagnostic logs</h3><p>Detailed logs exist only for explicit admin developer-mode requests and expire within 24 hours. Viewing and deletion are audited.</p></div><span className="section-count">{logs.length}</span></div>
    {logs.length === 0 ? <p className="muted">No unexpired developer diagnostic logs.</p> : <div className="diagnostic-log-list">{logs.map((log) => <details key={log.diagnostic_id} className="diagnostic-log-card">
      <summary><span><strong>{log.status.replace('_', ' ')}</strong><small>{log.model_id} · {log.thinking_level} · {log.timing_ms} ms</small></span><span><small>Expires {new Date(log.expires_at).toLocaleString()}</small></span></summary>
      <div className="diagnostic-log-actions"><button className="button button-secondary danger-text" type="button" onClick={() => void deleteLog(log)}><Trash2 size={15} /> Delete log</button></div>
      <dl><div><dt>Output-token limit</dt><dd>{log.output_token_limit}</dd></div><div><dt>Created</dt><dd>{new Date(log.created_at).toLocaleString()}</dd></div><div><dt>Log ID</dt><dd><code>{log.diagnostic_id}</code></dd></div></dl>
      {[['Exact prompt', log.prompt], ['Raw Gemini output', log.raw_output], ['Parsed output', log.parsed_output], ['Validation errors', log.validation_errors], ['Image metadata', log.image_metadata], ['Provider error details', log.provider_error]].map(([label, value]) => <section key={String(label)}><h4>{String(label)}</h4><pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null'}</pre></section>)}
    </details>)}</div>}
  </section>
}

function ClassManagementPanel({
  classes,
  courseNames,
  courseFilter,
  canonicalId,
  duplicateId,
  onCourseFilter,
  onCanonicalId,
  onDuplicateId,
  onEdit,
  onPermanentDelete,
  onAdminAction,
}: {
  classes: AdminClassRecord[]
  courseNames: AdminCourseNameRecord[]
  courseFilter: string | null
  canonicalId: string
  duplicateId: string
  onCourseFilter: (id: string | null) => void
  onCanonicalId: (id: string) => void
  onDuplicateId: (id: string) => void
  onEdit: (course: AdminClassRecord) => void
  onPermanentDelete: (course: AdminClassRecord) => void
  onAdminAction: (name: string, args: Record<string, unknown>, success: string) => Promise<void>
}) {
  const [canonicalCourseNameId, setCanonicalCourseNameId] = useState('')
  const [duplicateCourseNameId, setDuplicateCourseNameId] = useState('')
  const [courseCatalogExpanded, setCourseCatalogExpanded] = useState(false)
  const visibleClasses = courseFilter ? classes.filter((course) => course.course_name_id === courseFilter) : classes
  const unusedClassCount = visibleClasses.filter((course) => course.active_enrollment_count === 0).length

  function addCourseName() {
    const name = window.prompt('New course name')?.trim()
    if (!name) return
    void onAdminAction('admin_create_course_name', { p_name: name, p_reason: 'Added from admin course catalog' }, `${name} was added to the course catalog.`)
  }

  function renameCourseName(courseName: AdminCourseNameRecord) {
    const name = window.prompt('Rename course', courseName.course_name)?.trim()
    if (!name || name === courseName.course_name) return
    void onAdminAction('admin_rename_course_name', { p_course_name_id: courseName.id, p_name: name, p_reason: 'Renamed from admin course catalog' }, `${courseName.course_name} was renamed to ${name}.`)
  }

  return <section className="admin-section class-management-section">
    <div className="section-heading course-catalog-heading"><div><h2>Course catalog <span className="section-count">({courseNames.length})</span></h2><p>Manage reusable course names separately from their teacher, period, day, and term sections.</p></div><div className="course-catalog-actions"><button className="button button-primary" type="button" onClick={addCourseName}><Plus size={17} /> Add course name</button><button className="button button-secondary catalog-toggle" type="button" aria-expanded={courseCatalogExpanded} aria-controls="admin-course-catalog-content" onClick={() => setCourseCatalogExpanded((expanded) => !expanded)}>{courseCatalogExpanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}{courseCatalogExpanded ? 'Hide catalog' : 'Show catalog'}</button></div></div>
    {courseCatalogExpanded ? <div id="admin-course-catalog-content">
    <div className="admin-table admin-course-table"><div className="admin-table-head"><span>Course name</span><span>Source</span><span>Sections</span><span>Status</span><span>Actions</span></div>{courseNames.map((courseName) => <div className="admin-table-row" key={courseName.id}><span><strong>{courseName.course_name}</strong><small>{courseName.id}</small></span><span>{courseName.source}</span><span><strong>{courseName.active_section_count} active</strong><small>{courseName.section_count} total</small></span><span>{courseName.status}</span><span className="row-actions"><button type="button" onClick={() => onCourseFilter(courseName.id)}>View sections</button>{courseName.status !== 'merged' ? <button type="button" onClick={() => renameCourseName(courseName)}>Rename</button> : null}{courseName.status !== 'merged' ? <button className={courseName.status === 'active' ? 'danger-text' : ''} type="button" onClick={() => { const enabling = courseName.status !== 'active'; if (window.confirm(`${enabling ? 'Enable' : 'Disable'} ${courseName.course_name}? Existing schedules keep their linked name.`)) void onAdminAction('admin_set_course_name_enabled', { p_course_name_id: courseName.id, p_enabled: enabling, p_reason: `${enabling ? 'Enabled' : 'Disabled'} from admin course catalog` }, `${courseName.course_name} was ${enabling ? 'enabled' : 'disabled'}.`) }}>{courseName.status === 'active' ? 'Disable' : 'Enable'}</button> : null}</span></div>)}</div>

    <div className="merge-tool"><Merge /><label>Canonical course-name ID<input value={canonicalCourseNameId} onChange={(event) => setCanonicalCourseNameId(event.target.value)} /></label><label>Duplicate course-name ID<input value={duplicateCourseNameId} onChange={(event) => setDuplicateCourseNameId(event.target.value)} /></label><button className="button button-primary" disabled={!canonicalCourseNameId || !duplicateCourseNameId} onClick={() => { if (window.confirm('Relink every section to the canonical course name and mark the duplicate name as merged? Sections will remain separate.')) void onAdminAction('admin_merge_course_names', { p_canonical_course_name_id: canonicalCourseNameId, p_duplicate_course_name_id: duplicateCourseNameId, p_reason: 'Duplicate course-name merge' }, 'Course names merged without merging sections.') }}>Merge course names</button></div>

    </div> : null}
    <div className="section-heading class-sections-heading"><div><h2>Class sections</h2><p>Archive sections to deactivate schedules, or permanently delete a section with an impact-aware confirmation. <strong>{unusedClassCount}</strong> {unusedClassCount === 1 ? 'section is' : 'sections are'} not on anyone's schedule.</p></div>{courseFilter ? <button className="button button-secondary" type="button" onClick={() => onCourseFilter(null)}>Show all sections</button> : null}</div>
    <div className="merge-tool"><Merge /><label>Canonical section ID<input value={canonicalId} onChange={(event) => onCanonicalId(event.target.value)} /></label><label>Duplicate section ID<input value={duplicateId} onChange={(event) => onDuplicateId(event.target.value)} /></label><button className="button button-primary" disabled={!canonicalId || !duplicateId} onClick={() => { if (window.confirm('Move all enrollments and archive the duplicate section?')) void onAdminAction('admin_merge_classes', { p_canonical_class_id: canonicalId, p_duplicate_class_id: duplicateId, p_reason: 'Duplicate class-section merge' }, 'Class sections merged transactionally.') }}>Merge sections</button></div>
    <div className="admin-table admin-class-table"><div className="admin-table-head"><span>Course / section</span><span>Teacher / slots</span><span>Term</span><span>Status</span><span>Actions</span></div>{visibleClasses.map((course) => <div className={course.active_enrollment_count === 0 ? 'admin-table-row is-unused' : 'admin-table-row'} key={course.id}><span><strong>{course.course_name}</strong><small>{course.id}</small></span><span><strong>{course.teacher_last_name}</strong><small>{formatMeetingSlotSummary(course.meeting_slots)}</small></span><span>{course.default_academic_term.replace('_', ' ')}</span><span><strong>{course.status}</strong><small>{course.active_enrollment_count === 0 ? 'Not on any schedule' : `${course.active_enrollment_count} active / ${course.total_enrollment_count} total`}</small></span><span className="row-actions">{course.status === 'active' ? <button onClick={() => onEdit(course)}>Edit</button> : null}{course.status === 'active' ? <button className="danger-text" onClick={() => { if (window.confirm(`Archive ${course.course_name} with ${course.teacher_last_name}? Active enrollments will be deactivated.`)) void onAdminAction('admin_archive_class', { p_class_id: course.id, p_reason: 'Archived from admin console' }, 'Class section archived.') }}>Archive</button> : null}<button className="danger-text" onClick={() => onPermanentDelete(course)}>Delete permanently</button></span></div>)}</div>
  </section>
}

function ReportDetails({ report, onClose }: { report: AdminReportRecord; onClose: () => void }) {
  return <article className="report-detail-panel" aria-label="Report details"><header><div><span>Report details</span><h3>{reportReasonLabels[report.reason_category]}</h3></div><button className="icon-button" type="button" aria-label="Close report details" onClick={onClose}><X size={18} /></button></header><dl><div><dt>Reported</dt><dd>{report.reported_user_name ?? report.reported_course_name ?? 'General issue'}</dd></div><div><dt>Submitted by</dt><dd>{report.reporter_name ?? 'Deleted user'}</dd></div><div><dt>Submitted</dt><dd>{new Date(report.created_at).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{report.status.replace('_', ' ')}</dd></div>{report.assigned_admin_name ? <div><dt>Assigned admin</dt><dd>{report.assigned_admin_name}</dd></div> : null}{report.resolved_at ? <div><dt>Resolved</dt><dd>{new Date(report.resolved_at).toLocaleString()}</dd></div> : null}</dl><section><h4>Submitted description</h4><p>{report.explanation ?? 'No additional description was submitted.'}</p></section>{report.resolution_notes ? <section><h4>Resolution notes</h4><p>{report.resolution_notes}</p></section> : null}</article>
}

function AdminClassEditDialog({
  course,
  courseNames,
  saving,
  onClose,
  onSave,
}: {
  course: AdminClassRecord
  courseNames: AdminCourseNameRecord[]
  saving: boolean
  onClose: () => void
  onSave: (input: { courseNameId: string; teacherLastName: string; term: AcademicTerm; isDoublePeriod: boolean; meetingSlots: MeetingSlot[]; reason: string }) => Promise<void>
}) {
  const [courseNameId, setCourseNameId] = useState(course.course_name_id)
  const [teacherLastName, setTeacherLastName] = useState(course.teacher_last_name)
  const [term, setTerm] = useState<AcademicTerm>(course.default_academic_term)
  const [isDoublePeriod, setIsDoublePeriod] = useState(course.is_double_period || hasMultiplePeriodsOnAnyDay(course.meeting_slots))
  const [meetingDays, setMeetingDays] = useState<MeetingDaySelection>(meetingDaySelectionFromSlots(course.meeting_slots))
  const [meetingPeriod, setMeetingPeriod] = useState(meetingPeriodFromSlots(course.meeting_slots))
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(course.meeting_slots)
  const [reason, setReason] = useState('Corrected from admin class management')
  const normalMeetingSlots = buildNormalMeetingSlots(meetingDays, meetingPeriod)
  const activeMeetingSlots = isDoublePeriod ? meetingSlots : normalMeetingSlots
  const slotError = validateMeetingSlots(activeMeetingSlots, isDoublePeriod)
  const teacherError = teacherLastNameError(teacherLastName)
  const canSave = Boolean(courseNameId) && !teacherError && reason.trim().length >= 3 && !slotError

  function changeDoublePeriod(nextIsDoublePeriod: boolean) {
    setIsDoublePeriod(nextIsDoublePeriod)
    if (!nextIsDoublePeriod) {
      setMeetingSlots(normalMeetingSlots)
      return
    }
    if (hasMultiplePeriodsOnAnyDay(meetingSlots)) return
    setMeetingSlots(defaultDoubleMeetingSlots(preferredMeetingDay(meetingSlots), meetingPeriod))
  }

  function changeMeetingDays(nextMeetingDays: MeetingDaySelection) {
    setMeetingDays(nextMeetingDays)
    if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(nextMeetingDays, meetingPeriod))
  }

  function changeMeetingPeriod(nextMeetingPeriod: number) {
    setMeetingPeriod(nextMeetingPeriod)
    if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(meetingDays, nextMeetingPeriod))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    void onSave({ courseNameId, teacherLastName, term, isDoublePeriod, meetingSlots: activeMeetingSlots, reason })
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="class-dialog admin-class-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-class-title"><div className="sheet-handle" aria-hidden="true" /><header><div><h2 id="edit-class-title">Edit class section</h2><p>{course.active_enrollment_count} active enrollment{course.active_enrollment_count === 1 ? '' : 's'} will receive this update.</p></div><button className="icon-button" type="button" aria-label="Close" disabled={saving} onClick={onClose}><X aria-hidden="true" /></button></header><form className="create-class-form" onSubmit={submit}><div className="two-field-row"><label>Course name<select required value={courseNameId} onChange={(event) => setCourseNameId(event.target.value)}>{courseNames.filter((item) => item.status === 'active' || item.id === course.course_name_id).map((item) => <option value={item.id} key={item.id}>{item.course_name}</option>)}</select></label><label>Teacher Last Name<input required maxLength={120} value={teacherLastName} onChange={(event) => setTeacherLastName(event.target.value)} /><small className="field-help">Enter only the last name; compound last names are allowed.</small></label></div>{teacherError ? <p className="form-error" role="alert">{teacherError}</p> : null}<label>Academic term<select value={term} onChange={(event) => setTerm(event.target.value as AcademicTerm)}><option value="full_year">Full Year</option><option value="semester_1">Semester 1</option><option value="semester_2">Semester 2</option></select></label><MeetingSlotEditor isDoublePeriod={isDoublePeriod} meetingSlots={meetingSlots} meetingDays={meetingDays} meetingPeriod={meetingPeriod} onDoublePeriodChange={changeDoublePeriod} onMeetingDaysChange={changeMeetingDays} onMeetingPeriodChange={changeMeetingPeriod} onMeetingSlotsChange={setMeetingSlots} />{slotError ? <p className="form-error" role="alert">{slotError}</p> : null}<label>Audit reason<input required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save class changes'}</button></div></form></section></div>
}

function AdminLogTable({ title, rows, primary, target }: { title: string; rows: Array<Record<string, unknown>>; primary: string; target: string }) {
  return <section className="admin-section"><h2>{title}</h2><div className="admin-table"><div className="admin-table-head"><span>Action</span><span>Target</span><span>Actor</span><span>Timestamp</span><span>Details</span></div>{rows.map((row) => <div className="admin-table-row" key={String(row.id)}><span>{String(row[primary])}</span><span>{String(row[target] ?? '—')}</span><span>{String(row.administrator_id ?? row.changed_by ?? 'system')}</span><span>{new Date(String(row.created_at)).toLocaleString()}</span><span><code>{JSON.stringify(row.after_values ?? row.new_value ?? {})}</code></span></div>)}</div></section>
}
