import { AlertCircle, BarChart3, BookOpen, BrainCircuit, Bug, Clock3, Database, FileClock, Flag, Gauge, GraduationCap, ShieldCheck, Users, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { HomepageLayoutPanel } from '../components/admin/HomepageLayoutPanel'
import { BellScheduleAdminPanel } from '../components/admin/BellScheduleAdminPanel'
import { IssuesPanel } from '../components/admin/IssuesPanel'
import { useAdminDialogs } from '../components/admin/AdminDialogs'
import { AdminClassEditDialog, ClassSectionsPanel, classEditErrorMessage, CourseCatalogPanel } from '../components/admin/AdminClassPanels'
import { ScheduleEngineAdminPanel } from '../components/admin/AdminEnginePanel'
import { AdministratorsSection, ReportDialog, ReportsSection, UsersSection } from '../components/admin/AdminPeoplePanels'
import { AiImporterManagementPanel, ClubPromptPanel, HomepageStatisticPanel } from '../components/admin/AdminSettingsPanels'
import { EventLogsPanel, ProtectedToolsPanel } from '../components/admin/AdminSuperAdminPanels'
import { useCopyToClipboard, type AdminActionRunner } from '../components/admin/adminShared'
import { PageHeader } from '../components/ui/PageHeader'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import type { AcademicTerm, AdminClassRecord, AdminCourseNameRecord, AdminReportRecord, AdminScheduleEngineJob, AdminUserRecord, MeetingSlot } from '../lib/domain'
import { adminRemoveProfilePicture } from '../lib/profile'
import { supabase } from '../lib/supabase/client'
import { adminListClasses, adminListCourseNames, adminListReports, adminListScheduleEngineJobs, adminListUsers, adminUpdateClass, callAdminAction, isCurrentUserSuperAdmin } from '../lib/supabase/data'

// Panels other modules and tests import from the page.
export { ClubPromptPanel, HomepageStatisticPanel } from '../components/admin/AdminSettingsPanels'
export { EventLogsPanel, eventLogPageNumbers } from '../components/admin/AdminSuperAdminPanels'

type AdminSection = 'users' | 'reports' | 'admins' | 'classes' | 'catalog' | 'engine' | 'homepage' | 'bell-schedules' | 'ai' | 'issues' | 'logs' | 'protected'

interface SectionLink {
  id: AdminSection
  label: string
  icon: LucideIcon
}

interface SectionGroup {
  label: string
  superAdminOnly?: boolean
  sections: SectionLink[]
}

const sectionGroups: SectionGroup[] = [
  {
    label: 'People',
    sections: [
      { id: 'users', label: 'Users', icon: Users },
      { id: 'reports', label: 'Reports', icon: Flag },
      { id: 'admins', label: 'Administrators', icon: ShieldCheck },
    ],
  },
  {
    label: 'Classes',
    sections: [
      { id: 'classes', label: 'Class sections', icon: GraduationCap },
      { id: 'catalog', label: 'Course catalog', icon: BookOpen },
      { id: 'engine', label: 'Schedule Engine', icon: Gauge },
    ],
  },
  {
    label: 'Site',
    sections: [
      { id: 'homepage', label: 'Homepage', icon: BarChart3 },
      { id: 'bell-schedules', label: 'Bell schedules', icon: Clock3 },
      { id: 'ai', label: 'AI importer', icon: BrainCircuit },
      { id: 'issues', label: 'Issues', icon: Bug },
    ],
  },
  {
    label: 'Super administrator',
    superAdminOnly: true,
    sections: [
      { id: 'logs', label: 'Audit logs', icon: FileClock },
      { id: 'protected', label: 'Protected tools', icon: Database },
    ],
  },
]

const demoNow = Date.now()
const minutesAgo = (minutes: number) => new Date(demoNow - minutes * 60_000).toISOString()

const demoUsers = [
  { user_id: 'a', full_name: 'Jordan Smith', grade: 11, privacy_setting: 'classmates', status: 'active', is_admin: true, created_at: minutesAgo(60 * 24 * 40), last_login_at: minutesAgo(3), last_active_at: minutesAgo(1) },
  { user_id: 'b', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'private', status: 'active', is_admin: false, created_at: minutesAgo(60 * 24 * 12), last_login_at: null, last_active_at: null },
  { user_id: 'c', full_name: 'Suspicious Account', grade: 9, privacy_setting: 'school', status: 'suspended', is_admin: false, created_at: minutesAgo(60 * 24 * 2), last_login_at: null, last_active_at: null },
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
  created_at: minutesAgo(90),
  resolved_at: null,
}, {
  report_id: 'demo-report-resolved',
  reason_category: 'incorrect_class_information',
  explanation: 'AP Language with Carter is listed as period 2 on B days, but it meets period 1.',
  status: 'resolved',
  reporter_id: 'demo-reporter-2',
  reporter_name: 'Taylor Reed',
  reported_user_id: null,
  reported_user_name: null,
  reported_class_id: 'demo-class',
  reported_course_name: 'AP Language',
  assigned_admin_id: 'a',
  assigned_admin_name: 'Jordan Smith',
  resolution_notes: 'Corrected the B-day period for every enrolled student.',
  created_at: minutesAgo(60 * 30),
  resolved_at: minutesAgo(60 * 26),
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
  created_at: minutesAgo(60 * 24 * 40),
  updated_at: minutesAgo(60 * 24 * 3),
}, {
  id: 'demo-class-chem',
  course_name_id: 'demo-course-chem',
  course_name: 'Honors Chemistry',
  teacher_last_name: 'Nguyen',
  default_academic_term: 'full_year',
  is_double_period: true,
  meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'A', period_number: 4 }],
  status: 'active',
  active_enrollment_count: 0,
  total_enrollment_count: 2,
  report_count: 0,
  created_by: null,
  created_at: minutesAgo(60 * 24 * 20),
  updated_at: minutesAgo(60 * 24 * 20),
}]

const demoCourseNames: AdminCourseNameRecord[] = [{
  id: 'demo-course',
  course_name: 'AP Language',
  status: 'active',
  source: 'approved',
  section_count: 1,
  active_section_count: 1,
  alias_count: 1,
  aliases: [{ id: 'demo-alias', alias: 'AP Lang and Comp', source: 'import_correction', source_import_id: null, learned_count: 4, last_seen_at: minutesAgo(60 * 5), created_at: minutesAgo(60 * 24 * 9) }],
  created_at: minutesAgo(60 * 24 * 40),
  updated_at: minutesAgo(60 * 24 * 40),
}, {
  id: 'demo-course-chem',
  course_name: 'Honors Chemistry',
  status: 'active',
  source: 'approved',
  section_count: 1,
  active_section_count: 1,
  alias_count: 0,
  aliases: [],
  created_at: minutesAgo(60 * 24 * 40),
  updated_at: minutesAgo(60 * 24 * 40),
}]

const demoEngineJobs: AdminScheduleEngineJob[] = [{
  id: 'demo-engine-queued',
  status: 'queued',
  emailNotification: true,
  notificationStatus: 'pending',
  queuedAt: minutesAgo(4),
  processingStartedAt: null,
  completedAt: null,
  failedAt: null,
  cancelledAt: null,
  errorMessage: null,
  noValidScheduleReason: null,
  createdAt: minutesAgo(4),
  updatedAt: minutesAgo(4),
  sourceCourses: [{ position: 1, enrollmentId: 'demo-enrollment', courseId: 'demo-course', courseName: 'AP Language' }],
  replacementCourses: [{ position: 1, courseId: 'demo-course-chem', courseName: 'Honors Chemistry' }],
  predictions: [],
  userId: 'b',
  userName: 'Taylor Reed',
  workerId: null,
  attemptCount: 0,
  claimedAt: null,
  heartbeatAt: null,
  notificationSentAt: null,
  notificationError: null,
}, {
  id: 'demo-engine-completed',
  status: 'completed',
  emailNotification: false,
  notificationStatus: 'not_requested',
  queuedAt: minutesAgo(60 * 6),
  processingStartedAt: minutesAgo(60 * 6 - 1),
  completedAt: minutesAgo(60 * 6 - 3),
  failedAt: null,
  cancelledAt: null,
  errorMessage: null,
  noValidScheduleReason: null,
  createdAt: minutesAgo(60 * 6),
  updatedAt: minutesAgo(60 * 6 - 3),
  sourceCourses: [{ position: 1, enrollmentId: 'demo-enrollment-2', courseId: 'demo-course-chem', courseName: 'Honors Chemistry' }],
  replacementCourses: [{ position: 1, courseId: 'demo-course', courseName: 'AP Language' }],
  predictions: [],
  userId: 'a',
  userName: 'Jordan Smith',
  workerId: 'laptop-worker-1',
  attemptCount: 1,
  claimedAt: minutesAgo(60 * 6 - 1),
  heartbeatAt: minutesAgo(60 * 6 - 3),
  notificationSentAt: null,
  notificationError: null,
}]














function adminActionErrorMessage(caught: unknown, action: string) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('class_not_found')) return 'That class section no longer exists. Refresh the class list and try again.'
  if (message.includes('not_admin') || message.includes('administrator')) return 'Administrator access is required for this action.'
  if (message.includes('course_alias_already_exists')) return 'That possible name is already assigned to a course.'
  if (message.includes('alias_conflicts_with_course_name') || message.includes('course_name_conflicts_with_alias')) return 'That name is already used by another catalogue course.'
  if (message.includes('alias_matches_canonical_name')) return 'The possible name is already the course’s canonical name.'
  if (message.includes('invalid_course_alias')) return 'Enter a possible course name between 2 and 160 characters.'
  if (message.includes('invalid_course_name')) return 'Enter a course name between 2 and 120 characters.'
  if (message.includes('foreign key') || message.includes('violates')) {
    return action === 'admin_delete_class_section'
      ? 'The class section could not be deleted because a related record was not handled safely. No changes were kept; refresh and try again.'
      : 'The database didn’t accept this change, so nothing was saved. Check what you entered and try again.'
  }
  return message || 'Admin action failed.'
}


function isSection(value: string | null, allowed: AdminSection[]): value is AdminSection {
  return value !== null && (allowed as string[]).includes(value)
}

export function AdminPage() {
  const { isDemo } = useAuth()
  const { showToast } = useToast()
  const dialogs = useAdminDialogs()
  const copy = useCopyToClipboard()
  const [searchParams] = useSearchParams()
  const [users, setUsers] = useState<AdminUserRecord[]>(isDemo ? demoUsers as AdminUserRecord[] : [])
  const [reports, setReports] = useState<AdminReportRecord[]>(isDemo ? demoReports : [])
  const [classes, setClasses] = useState<AdminClassRecord[]>(isDemo ? demoClasses : [])
  const [courseNames, setCourseNames] = useState<AdminCourseNameRecord[]>(isDemo ? demoCourseNames : [])
  const [engineJobs, setEngineJobs] = useState<AdminScheduleEngineJob[]>(isDemo ? demoEngineJobs : [])
  const [loaded, setLoaded] = useState(isDemo || !supabase)
  const [loading, setLoading] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [avatarRevision, setAvatarRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState<number | ''>('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [canonicalId, setCanonicalId] = useState('')
  const [duplicateId, setDuplicateId] = useState('')
  const [adminUserId, setAdminUserId] = useState('')
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editingClass, setEditingClass] = useState<AdminClassRecord | null>(null)
  const [classSaving, setClassSaving] = useState(false)
  const [classEditError, setClassEditError] = useState<string | null>(null)
  const [courseFilter, setCourseFilter] = useState<string | null>(null)

  const groups = sectionGroups.filter((group) => !group.superAdminOnly || isSuperAdmin)
  const allowedSections = groups.flatMap((group) => group.sections.map((item) => item.id))
  const requestedSection = searchParams.get('section')
  const section: AdminSection = isSection(requestedSection, allowedSections) ? requestedSection : 'users'
  const queuedCount = engineJobs.filter((job) => job.status === 'queued').length
  const openReportCount = reports.filter((report) => report.status === 'open' || report.status === 'in_review').length

  const load = useCallback(async () => {
    if (isDemo || !supabase) return
    setLoading(true)
    try {
      const [nextUsers, nextReports, nextClasses, nextCourseNames, nextEngineJobs] = await Promise.all([
        adminListUsers(query, grade || undefined, status || undefined),
        adminListReports(),
        adminListClasses(),
        adminListCourseNames(),
        adminListScheduleEngineJobs(),
      ])
      setUsers(nextUsers)
      setReports(nextReports)
      setClasses(nextClasses)
      setCourseNames(nextCourseNames)
      setEngineJobs(nextEngineJobs)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load administrative data.')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [grade, isDemo, query, status])

  useEffect(() => {
    if (isDemo) return
    void isCurrentUserSuperAdmin().then(setIsSuperAdmin).catch(() => setIsSuperAdmin(false))
  }, [isDemo])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(timer)
  }, [load])

  // A message about one section shouldn't follow the administrator to another.
  useEffect(() => { setError(null) }, [section])

  // Switching sections from far down a long table starts the new section at its top.
  const contentRef = useRef<HTMLDivElement>(null)
  const previousSection = useRef(section)
  useEffect(() => {
    if (previousSection.current === section) return
    previousSection.current = section
    const content = contentRef.current
    if (content && content.getBoundingClientRect().top < 0 && typeof content.scrollIntoView === 'function') content.scrollIntoView({ block: 'start' })
  }, [section])

  const adminAction: AdminActionRunner = useCallback(async (name, args, success, options) => {
    setError(null)
    try {
      if (!isDemo) await callAdminAction(name, args)
      showToast(success)
      await load()
      return true
    } catch (caught) {
      const message = adminActionErrorMessage(caught, name)
      if (options?.onError) options.onError(message)
      else setError(message)
      return false
    }
  }, [isDemo, load, showToast])

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
    setClassEditError(null)
    try {
      if (!isDemo) await adminUpdateClass({ classId: editingClass.id, ...input })
      setEditingClass(null)
      const courseName = courseNames.find((item) => item.id === input.courseNameId)?.course_name ?? 'The class section'
      showToast(`${courseName} was updated everywhere this shared section is used.`)
      await load()
    } catch (caught) {
      setClassEditError(classEditErrorMessage(caught))
    } finally {
      setClassSaving(false)
    }
  }

  async function suspendUser(user: AdminUserRecord) {
    const reasonText = await dialogs.prompt({
      title: `Suspend ${user.full_name}?`,
      description: 'They lose access right away and stay signed out until an administrator restores the account.',
      label: 'Reason for suspending',
      help: 'Recorded in the audit log.',
      multiline: true,
      maxLength: 1000,
      submitLabel: 'Suspend account',
      tone: 'danger',
    })
    if (reasonText) void adminAction('admin_suspend_user', { p_user_id: user.user_id, p_reason: reasonText }, `${user.full_name} was suspended.`)
  }

  function restoreUser(user: AdminUserRecord) {
    void adminAction('admin_restore_user', { p_user_id: user.user_id, p_reason: 'Restored from admin console' }, `${user.full_name} was restored.`)
  }

  async function editName(user: AdminUserRecord) {
    const fullName = await dialogs.prompt({
      title: 'Edit name',
      description: `Correct how ${user.full_name} appears to other students.`,
      label: 'Full name',
      defaultValue: user.full_name,
      maxLength: 100,
      submitLabel: 'Save name',
    })
    if (fullName) void adminAction('admin_update_user', { p_user_id: user.user_id, p_full_name: fullName, p_grade: user.grade, p_privacy_setting: user.privacy_setting, p_reason: 'Profile name correction' }, 'Profile updated.')
  }

  async function changeGrade(user: AdminUserRecord) {
    const typed = await dialogs.prompt({
      title: 'Change grade',
      description: `Correct ${user.full_name}’s grade level.`,
      label: 'Grade',
      defaultValue: String(user.grade ?? 9),
      options: [9, 10, 11, 12].map((value) => ({ value: String(value), label: `Grade ${value}` })),
      submitLabel: 'Save grade',
    })
    if (typed === null) return
    const nextGrade = Number(typed)
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

  async function removeUserPicture(user: AdminUserRecord) {
    const name = user.full_name
    const confirmed = await dialogs.confirm({
      title: `Remove ${name}’s profile picture?`,
      message: 'Their initials will be shown instead.',
      confirmLabel: 'Remove picture',
      tone: 'danger',
    })
    if (!confirmed) return
    setError(null)
    try {
      if (!isDemo) await adminRemoveProfilePicture(String(user.user_id))
      setAvatarRevision(Date.now())
      showToast(`${name}'s profile picture was removed.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The profile picture could not be removed.')
    }
  }

  async function deleteUser(user: AdminUserRecord) {
    const expected = user.full_name
    const typed = await dialogs.prompt({
      title: `Delete ${expected}’s account?`,
      description: 'This permanently deletes the account, revokes access, and removes their sign-in data. It can’t be undone.',
      label: `Type “${expected}” to confirm`,
      match: expected,
      submitLabel: 'Delete account',
      tone: 'danger',
    })
    if (typed !== expected) return
    void adminAction('admin_delete_user', { p_user_id: user.user_id, p_reason: 'Deleted from admin console' }, `${expected} was deleted.`)
  }

  const selectedReport = reports.find((report) => report.report_id === selectedReportId) ?? null
  const counts: Partial<Record<AdminSection, { value: number; label: string }>> = {
    engine: { value: queuedCount, label: 'queued' },
    reports: { value: openReportCount, label: 'open' },
  }

  return (
    <div className="page admin-page">
      <PageHeader
        title="Administration"
        description="Manage accounts, reports, classes, and site settings for everyone who uses ScheduleShare."
        actions={<span className="badge badge-outline admin-role-badge"><ShieldCheck aria-hidden="true" />{isSuperAdmin ? 'Super administrator' : 'Administrator'}</span>}
      />

      <div className="admin-layout">
        <AdminNav groups={groups} active={section} counts={counts} />

        <div className="admin-content" id="admin-content" ref={contentRef}>
          {error ? <div className="notice notice-danger admin-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <p>{error}</p>
            <button className="icon-button" type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X aria-hidden="true" /></button>
          </div> : null}

          {section === 'users' ? <UsersSection
            users={users}
            loaded={loaded}
            loading={loading}
            query={query}
            grade={grade}
            status={status}
            avatarRevision={avatarRevision}
            onQuery={setQuery}
            onGrade={setGrade}
            onStatus={setStatus}
            menuFor={(user) => [
              { label: 'Copy user ID', onSelect: () => void copy(user.user_id, 'User ID') },
              'separator',
              { label: 'Edit name', onSelect: () => void editName(user) },
              { label: 'Change grade', onSelect: () => void changeGrade(user) },
              { label: 'Remove picture', onSelect: () => void removeUserPicture(user) },
              'separator',
              user.status === 'suspended'
                ? { label: 'Restore account', onSelect: () => restoreUser(user) }
                : { label: 'Suspend account', onSelect: () => void suspendUser(user) },
              { label: 'Delete account', tone: 'danger', onSelect: () => void deleteUser(user) },
            ]}
          /> : null}

          {section === 'reports' ? <ReportsSection reports={reports} loaded={loaded} openCount={openReportCount} onReview={setSelectedReportId} /> : null}

          {section === 'admins' ? <AdministratorsSection
            userId={adminUserId}
            onUserId={setAdminUserId}
            onPromote={() => void adminAction('admin_promote_user', { p_user_id: adminUserId, p_reason: 'Promoted from admin console' }, 'Administrator access granted.')}
            onRemove={() => void adminAction('admin_remove_user_role', { p_user_id: adminUserId, p_reason: 'Removed from admin console' }, 'Administrator access removed.')}
          /> : null}

          {section === 'classes' ? <ClassSectionsPanel
            classes={classes}
            courseNames={courseNames}
            loaded={loaded}
            courseFilter={courseFilter}
            canonicalId={canonicalId}
            duplicateId={duplicateId}
            onCourseFilter={setCourseFilter}
            onCanonicalId={setCanonicalId}
            onDuplicateId={setDuplicateId}
            onEdit={(course) => { setClassEditError(null); setEditingClass(course) }}
            onAdminAction={adminAction}
          /> : null}

          {section === 'catalog' ? <CourseCatalogPanel
            courseNames={courseNames}
            loaded={loaded}
            onViewSections={setCourseFilter}
            onAdminAction={adminAction}
          /> : null}

          {section === 'engine' ? <ScheduleEngineAdminPanel jobs={engineJobs} loaded={loaded} loading={loading} onRefresh={() => void load()} /> : null}

          {section === 'homepage' ? <div className="admin-stack">
            <HomepageLayoutPanel isDemo={isDemo} />
            <HomepageStatisticPanel isDemo={isDemo} />
            <ClubPromptPanel isDemo={isDemo} />
          </div> : null}

          {section === 'bell-schedules' ? <BellScheduleAdminPanel isDemo={isDemo} /> : null}

          {section === 'ai' ? <AiImporterManagementPanel isDemo={isDemo} /> : null}

          {section === 'issues' ? <IssuesPanel isDemo={isDemo} /> : null}

          {section === 'logs' && isSuperAdmin ? <EventLogsPanel /> : null}
          {section === 'protected' && isSuperAdmin ? <ProtectedToolsPanel /> : null}
        </div>
      </div>

      {selectedReport ? <ReportDialog
        key={selectedReport.report_id}
        report={selectedReport}
        onClose={() => setSelectedReportId(null)}
        onResolve={(notes, onError) => adminAction('admin_resolve_report', { p_report_id: selectedReport.report_id, p_status: 'resolved', p_resolution_notes: notes }, 'Report resolved.', { onError })}
      /> : null}
      {editingClass ? <AdminClassEditDialog key={editingClass.id} course={editingClass} courseNames={courseNames} saving={classSaving} error={classEditError} onClose={() => setEditingClass(null)} onSave={saveClass} /> : null}
      {dialogs.dialog}
    </div>
  )
}

/* ---------- Navigation ---------- */

function AdminNav({ groups, active, counts }: { groups: SectionGroup[]; active: AdminSection; counts: Partial<Record<AdminSection, { value: number; label: string }>> }) {
  const navId = useId()

  useEffect(() => {
    // Keep the current section visible in the phone tab scroller.
    const current = document.querySelector<HTMLElement>('.admin-nav [aria-current="page"]')
    if (current && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <nav className="admin-nav" aria-label="Administration sections">
      {groups.map((group, groupIndex) => (
        <div className="admin-nav-group" key={group.label}>
          <p className="admin-nav-group-label" id={`${navId}-${groupIndex}`}>{group.label}</p>
          <ul aria-labelledby={`${navId}-${groupIndex}`}>
            {group.sections.map((item) => {
              const Icon = item.icon
              const count = counts[item.id]
              const current = item.id === active
              return (
                <li key={item.id}>
                  <Link className="admin-nav-item" to={`?section=${item.id}`} replace aria-current={current ? 'page' : undefined}>
                    <Icon aria-hidden="true" />
                    <span className="admin-nav-label">{item.label}</span>
                    {count && count.value > 0 ? <span className="badge admin-nav-count"><span aria-hidden="true">{count.value}</span><span className="sr-only">, {count.value} {count.label}</span></span> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
