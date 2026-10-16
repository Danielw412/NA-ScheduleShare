import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClassRecord, AdminCourseNameRecord, AdminReportRecord, AdminScheduleEngineJob, AdminUserRecord } from '../lib/domain'
import adminCss from '../styles/features/admin.css?raw'
import { getCssDeclarations } from '../test/css'
import { ToastProvider } from '../components/ui/Toast'
import { AdminPage } from './AdminPage'

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listReports: vi.fn(),
  listClasses: vi.fn(),
  listCourseNames: vi.fn(),
  listEngineJobs: vi.fn(),
  isSuperAdmin: vi.fn(),
  callAdminAction: vi.fn(),
  resetPreview: vi.fn(),
  resetSite: vi.fn(),
  removePicture: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isDemo: false }) }))
vi.mock('../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('../lib/profile', () => ({ profilePictureUrl: () => null, adminRemoveProfilePicture: mocks.removePicture }))
vi.mock('../lib/supabase/data', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as Record<string, unknown>),
    adminListUsers: mocks.listUsers,
    adminListReports: mocks.listReports,
    adminListClasses: mocks.listClasses,
    adminListCourseNames: mocks.listCourseNames,
    adminListScheduleEngineJobs: mocks.listEngineJobs,
    isCurrentUserSuperAdmin: mocks.isSuperAdmin,
    callAdminAction: mocks.callAdminAction,
    superAdminGetSiteResetPreview: mocks.resetPreview,
    superAdminResetSite: mocks.resetSite,
  }
})

const users: AdminUserRecord[] = [
  { user_id: 'user-jordan', full_name: 'Jordan Smith', grade: 11, privacy_setting: 'classmates', status: 'active', is_admin: true, created_at: '2026-08-01T12:00:00Z', last_login_at: '2026-10-15T12:00:00Z', last_active_at: '2026-10-15T12:30:00Z' },
  { user_id: 'user-taylor', full_name: 'Taylor Reed', grade: 11, privacy_setting: 'private', status: 'active', is_admin: false, created_at: '2026-08-01T12:00:00Z', last_login_at: null, last_active_at: null },
  { user_id: 'user-sam', full_name: 'Sam Lee', grade: 9, privacy_setting: 'school', status: 'suspended', is_admin: false, created_at: '2026-08-01T12:00:00Z', last_login_at: null, last_active_at: null },
]

const reports: AdminReportRecord[] = [{
  report_id: 'report-1', reason_category: 'suspicious_user', explanation: 'Sent misleading schedules.', status: 'open',
  reporter_id: 'user-jordan', reporter_name: 'Jordan Smith', reported_user_id: 'user-sam', reported_user_name: 'Sam Lee',
  reported_class_id: null, reported_course_name: null, assigned_admin_id: null, assigned_admin_name: null,
  resolution_notes: null, created_at: '2026-10-15T12:00:00Z', resolved_at: null,
}]

const classes: AdminClassRecord[] = [
  {
    id: 'class-lang', course_name_id: 'course-lang', course_name: 'AP Language', teacher_last_name: 'Carter', default_academic_term: 'full_year',
    is_double_period: false, meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }], status: 'active',
    active_enrollment_count: 2, total_enrollment_count: 2, report_count: 0, created_by: null, created_at: '', updated_at: '',
  },
  {
    id: 'class-chem', course_name_id: 'course-chem', course_name: 'Chemistry', teacher_last_name: 'Nguyen', default_academic_term: 'semester_1',
    is_double_period: false, meeting_slots: [{ day_type: 'A', period_number: 3 }], status: 'active',
    active_enrollment_count: 0, total_enrollment_count: 0, report_count: 0, created_by: null, created_at: '', updated_at: '',
  },
]

const courseNames: AdminCourseNameRecord[] = [
  { id: 'course-lang', course_name: 'AP Language', status: 'active', source: 'approved', section_count: 1, active_section_count: 1, alias_count: 0, aliases: [], created_at: '', updated_at: '' },
  { id: 'course-chem', course_name: 'Chemistry', status: 'active', source: 'approved', section_count: 1, active_section_count: 1, alias_count: 0, aliases: [], created_at: '', updated_at: '' },
]

const queuedJob = {
  id: 'job-1', status: 'queued', emailNotification: false, notificationStatus: 'not_requested', queuedAt: '2026-10-15T12:00:00Z',
  processingStartedAt: null, completedAt: null, failedAt: null, cancelledAt: null, errorMessage: null, noValidScheduleReason: null,
  createdAt: '2026-10-15T12:00:00Z', updatedAt: '2026-10-15T12:00:00Z',
  sourceCourses: [{ position: 1, enrollmentId: 'e1', courseId: 'course-lang', courseName: 'AP Language' }],
  replacementCourses: [{ position: 1, courseId: 'course-chem', courseName: 'Chemistry' }],
  predictions: [], userId: 'user-taylor', userName: 'Taylor Reed', workerId: null, attemptCount: 0, claimedAt: null,
  heartbeatAt: null, notificationSentAt: null, notificationError: null,
} as AdminScheduleEngineJob

function renderAdmin(section?: string) {
  return render(
    <MemoryRouter initialEntries={[section ? `/admin?section=${section}` : '/admin']}>
      <ToastProvider><AdminPage /></ToastProvider>
    </MemoryRouter>,
  )
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name }))
  return screen.getByRole('menu', { name })
}

beforeEach(() => {
  mocks.listUsers.mockResolvedValue(users)
  mocks.listReports.mockResolvedValue(reports)
  mocks.listClasses.mockResolvedValue(classes)
  mocks.listCourseNames.mockResolvedValue(courseNames)
  mocks.listEngineJobs.mockResolvedValue([queuedJob])
  mocks.isSuperAdmin.mockResolvedValue(false)
  mocks.callAdminAction.mockResolvedValue(null)
  mocks.resetPreview.mockResolvedValue({ accounts: 3, profiles: 3, classes: 2, course_names: 0, enrollments: 4, reports: 1, profile_pictures: 0, calendar_assignments: 10, sync_runs: 2 })
  mocks.resetSite.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminPage navigation', () => {
  it('lists sections with live counts and hides super-administrator tools from regular administrators', async () => {
    renderAdmin()
    const nav = screen.getByRole('navigation', { name: 'Administration sections' })
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
    expect(await within(nav).findByRole('link', { name: /Schedule Engine, 1 queued/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Reports, 1 open/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Issues' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Audit logs' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Protected tools' })).not.toBeInTheDocument()
  })

  it('ignores a protected section in the URL unless the account is a super administrator', async () => {
    renderAdmin('protected')
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reset for a new school year' })).not.toBeInTheDocument()
  })

  it('switches sections from the navigation', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('link', { name: /Reports/ }))
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current')
  })
})

describe('AdminPage user actions', () => {
  it('suspends a user with the typed reason and does nothing when cancelled', async () => {
    const user = userEvent.setup()
    renderAdmin()
    let menu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(menu).getByRole('menuitem', { name: 'Suspend account' }))
    let dialog = screen.getByRole('alertdialog', { name: 'Suspend Taylor Reed?' })
    expect(within(dialog).getByRole('button', { name: 'Suspend account' })).toBeDisabled()
    // account_moderation.suspension_reason allows at most 1000 characters.
    expect(within(dialog).getByLabelText('Reason for suspending')).toHaveAttribute('maxlength', '1000')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocks.callAdminAction).not.toHaveBeenCalled()

    menu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(menu).getByRole('menuitem', { name: 'Suspend account' }))
    dialog = screen.getByRole('alertdialog', { name: 'Suspend Taylor Reed?' })
    await user.type(within(dialog).getByLabelText('Reason for suspending'), 'Spam reports')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend account' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_suspend_user', { p_user_id: 'user-taylor', p_reason: 'Spam reports' }))
    expect(await screen.findByText('Taylor Reed was suspended.')).toBeInTheDocument()
  })

  it('restores a suspended user directly from the menu', async () => {
    const user = userEvent.setup()
    renderAdmin()
    const menu = await openRowMenu(user, 'Actions for Sam Lee')
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore account' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_restore_user', { p_user_id: 'user-sam', p_reason: 'Restored from admin console' }))
  })

  it('only deletes an account after the exact full name is typed', async () => {
    const user = userEvent.setup()
    renderAdmin()
    const menu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete account' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Taylor Reed’s account?' })
    const field = within(dialog).getByLabelText('Type “Taylor Reed” to confirm')
    const submit = within(dialog).getByRole('button', { name: 'Delete account' })
    await user.type(field, 'taylor reed')
    expect(submit).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'Taylor Reed')
    await user.click(submit)
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_delete_user', { p_user_id: 'user-taylor', p_reason: 'Deleted from admin console' }))
  })

  it('corrects a grade and a name with the same RPC arguments as before', async () => {
    const user = userEvent.setup()
    renderAdmin()
    let menu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(menu).getByRole('menuitem', { name: 'Change grade' }))
    let dialog = screen.getByRole('dialog', { name: 'Change grade' })
    await user.selectOptions(within(dialog).getByLabelText('Grade'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save grade' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_update_user', {
      p_user_id: 'user-taylor', p_full_name: 'Taylor Reed', p_grade: 12, p_privacy_setting: 'private', p_reason: 'Administrator grade correction',
    }))

    menu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    dialog = screen.getByRole('dialog', { name: 'Edit name' })
    const field = within(dialog).getByLabelText('Full name')
    expect(field).toHaveAttribute('maxlength', '100')
    await user.clear(field)
    await user.type(field, 'Taylor A. Reed')
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_update_user', {
      p_user_id: 'user-taylor', p_full_name: 'Taylor A. Reed', p_grade: 11, p_privacy_setting: 'private', p_reason: 'Profile name correction',
    }))
  })

  it('only blames a class deletion for a database constraint error when a class was being deleted', async () => {
    const user = userEvent.setup()
    mocks.callAdminAction.mockRejectedValueOnce(new Error('new row for relation "account_moderation" violates check constraint'))
    renderAdmin()
    const menu = await openRowMenu(user, 'Actions for Sam Lee')
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore account' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The database didn’t accept this change, so nothing was saved.')
    expect(alert).not.toHaveTextContent(/class section/)
  })

  it('shows a failed action inline instead of a success toast', async () => {
    const user = userEvent.setup()
    mocks.callAdminAction.mockRejectedValueOnce(new Error('not_admin'))
    renderAdmin()
    const menu = await openRowMenu(user, 'Actions for Sam Lee')
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access is required for this action.')
    expect(screen.queryByText('Sam Lee was restored.')).not.toBeInTheDocument()
  })
})

describe('AdminPage row menu', () => {
  it('moves focus into the menu, supports arrow keys, and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderAdmin()
    const trigger = await screen.findByRole('button', { name: 'Actions for Taylor Reed' })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Actions for Taylor Reed' })
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Copy user ID' })).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Edit name' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(within(menu).getByRole('menuitem', { name: 'Delete account' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('AdminPage dialog focus', () => {
  it('returns focus to the row menu trigger after a prompt or a confirmation closes', async () => {
    const user = userEvent.setup()
    renderAdmin()
    const trigger = await screen.findByRole('button', { name: 'Actions for Taylor Reed' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = screen.getByRole('menu', { name: 'Actions for Taylor Reed' })
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Copy user ID' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    const prompt = screen.getByRole('dialog', { name: 'Change grade' })
    expect(within(prompt).getByLabelText('Grade')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(prompt).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    const pictureMenu = await openRowMenu(user, 'Actions for Taylor Reed')
    await user.click(within(pictureMenu).getByRole('menuitem', { name: 'Remove picture' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Taylor Reed’s profile picture?' })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(confirm).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(mocks.removePicture).not.toHaveBeenCalled()
  })

  it('returns focus to a toolbar button after its prompt is cancelled', async () => {
    const user = userEvent.setup()
    renderAdmin('catalog')
    const add = await screen.findByRole('button', { name: 'Add course name' })
    await user.click(add)
    expect(within(screen.getByRole('dialog', { name: 'Add a course name' })).getByLabelText('Course name')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(add).toHaveFocus()
  })

  it('keeps focus and a failed removal inside the possible-names dialog', async () => {
    const user = userEvent.setup()
    mocks.listCourseNames.mockResolvedValue([
      { ...courseNames[0], alias_count: 1, aliases: [{ id: 'alias-1', alias: 'AP Lang', source: 'import_correction', source_import_id: null, learned_count: 2, last_seen_at: null, created_at: '' }] },
      courseNames[1],
    ])
    renderAdmin('catalog')
    const menu = await openRowMenu(user, 'More actions for AP Language')
    await user.click(within(menu).getByRole('menuitem', { name: 'Possible names' }))
    const aliasDialog = screen.getByRole('dialog', { name: 'Possible names for AP Language' })
    const remove = within(aliasDialog).getByRole('button', { name: 'Remove AP Lang' })

    await user.click(remove)
    let confirm = screen.getByRole('alertdialog', { name: 'Remove “AP Lang”?' })
    await user.keyboard('{Escape}')
    expect(confirm).not.toBeInTheDocument()
    expect(aliasDialog).toBeInTheDocument()
    expect(remove).toHaveFocus()

    mocks.callAdminAction.mockRejectedValueOnce(new Error('not_admin'))
    await user.click(remove)
    confirm = screen.getByRole('alertdialog', { name: 'Remove “AP Lang”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove name' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_delete_course_name_alias', { p_alias_id: 'alias-1', p_reason: 'Removed from admin course catalog' }))
    expect(await within(aliasDialog).findByRole('alert')).toHaveTextContent('Administrator access is required for this action.')
    expect(document.querySelector('.admin-error')).toBeNull()
  })
})

describe('AdminPage reports, classes, and roles', () => {
  it('resolves a report from the review dialog with the written notes', async () => {
    const user = userEvent.setup()
    renderAdmin('reports')
    await user.click(await screen.findByRole('button', { name: /Review suspicious user report about Sam Lee/ }))
    const dialog = screen.getByRole('dialog', { name: 'Suspicious user' })
    expect(within(dialog).getByText('Sent misleading schedules.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Resolution notes')).toHaveAttribute('maxlength', '4000')
    const resolve = within(dialog).getByRole('button', { name: 'Mark resolved' })
    expect(resolve).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Resolution notes'), 'Warned the student.')
    await user.click(resolve)
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_resolve_report', { p_report_id: 'report-1', p_status: 'resolved', p_resolution_notes: 'Warned the student.' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('confirms before deleting a section that students are enrolled in, but not an unused one', async () => {
    const user = userEvent.setup()
    renderAdmin('classes')
    let menu = await openRowMenu(user, 'More actions for AP Language with Carter')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete AP Language with Carter?' })
    // Focus starts on Cancel, so the consequences must be the dialog's description.
    expect(dialog).toHaveAccessibleDescription('2 active students are currently enrolled. Deleting the section removes it from their schedules permanently.')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_delete_class_section', { p_class_id: 'class-lang', p_reason: 'Permanently deleted from admin console' }))

    mocks.callAdminAction.mockClear()
    menu = await openRowMenu(user, 'More actions for Chemistry with Nguyen')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_delete_class_section', { p_class_id: 'class-chem', p_reason: 'Permanently deleted from admin console' }))
  })

  it('filters sections by course or teacher and merges duplicates from the dialog', async () => {
    const user = userEvent.setup()
    renderAdmin('classes')
    await screen.findByText('Carter')
    await user.type(screen.getByLabelText('Filter sections by course or teacher'), 'nguyen')
    expect(screen.queryByText('Carter')).not.toBeInTheDocument()
    expect(screen.getByText('Nguyen')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Merge duplicates' }))
    const dialog = screen.getByRole('dialog', { name: 'Merge duplicate sections' })
    await user.type(within(dialog).getByLabelText('Section ID to keep'), 'class-lang')
    await user.type(within(dialog).getByLabelText('Duplicate section ID'), 'class-chem')
    await user.click(within(dialog).getByRole('button', { name: 'Merge sections' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_merge_classes', { p_canonical_class_id: 'class-lang', p_duplicate_class_id: 'class-chem', p_reason: 'Duplicate class-section merge' }))
  })

  it('adds a trimmed course name and jumps from a course to its sections', async () => {
    const user = userEvent.setup()
    renderAdmin('catalog')
    await user.click(await screen.findByRole('button', { name: 'Add course name' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a course name' })
    expect(within(dialog).getByLabelText('Course name')).toHaveAttribute('maxlength', '120')
    await user.type(within(dialog).getByLabelText('Course name'), '  AP Biology  ')
    await user.click(within(dialog).getByRole('button', { name: 'Add course name' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_create_course_name', { p_name: 'AP Biology', p_reason: 'Added from admin course catalog' }))

    await user.click(screen.getByRole('button', { name: 'View sections of Chemistry' }))
    expect(await screen.findByRole('heading', { name: 'Class sections' })).toBeInTheDocument()
    expect(screen.getByText('Only Chemistry')).toBeInTheDocument()
    expect(screen.queryByText('Carter')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all sections' }))
    expect(screen.getByText('Carter')).toBeInTheDocument()
  })

  it('grants and removes administrator access by user ID', async () => {
    const user = userEvent.setup()
    renderAdmin('admins')
    await user.type(await screen.findByLabelText('User ID'), 'user-taylor')
    await user.click(screen.getByRole('button', { name: 'Make administrator' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_promote_user', { p_user_id: 'user-taylor', p_reason: 'Promoted from admin console' }))
    await user.click(screen.getByRole('button', { name: 'Remove administrator access' }))
    await waitFor(() => expect(mocks.callAdminAction).toHaveBeenCalledWith('admin_remove_user_role', { p_user_id: 'user-taylor', p_reason: 'Removed from admin console' }))
  })

  it('shows the Schedule Engine queue with readable request summaries', async () => {
    renderAdmin('engine')
    expect(await screen.findByText('Replace AP Language with Chemistry')).toBeInTheDocument()
    expect(screen.getByText('Not claimed yet')).toBeInTheDocument()
  })
})

describe('AdminPage protected tools', () => {
  it('requires the acknowledgement, the exact phrase, and a final confirmation before resetting', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mocks.isSuperAdmin.mockResolvedValue(true)
    renderAdmin('protected')
    const reset = await screen.findByRole('button', { name: 'Permanently reset ScheduleShare' })
    expect(reset).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await user.type(screen.getByLabelText(/^Type/), 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES')
    expect(reset).toBeEnabled()

    await user.click(reset)
    let dialog = screen.getByRole('alertdialog', { name: 'Reset ScheduleShare now?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocks.resetSite).not.toHaveBeenCalled()

    await user.click(reset)
    dialog = screen.getByRole('alertdialog', { name: 'Reset ScheduleShare now?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reset ScheduleShare' }))
    await waitFor(() => expect(mocks.resetSite).toHaveBeenCalledWith('RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES'))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
})

describe('admin stylesheet', () => {
  it('turns tables into labelled stacked rows in narrow containers and keeps the row menu above content', () => {
    expect(getCssDeclarations(adminCss, '.admin-content')).toMatchObject({ 'container-type': 'inline-size' })
    expect(adminCss).toMatch(/@container \(max-width: 680px\)[\s\S]*\.admin-table td\[data-label\]::before \{[^}]*content: attr\(data-label\)/)
    expect(getCssDeclarations(adminCss, '.admin-menu')).toMatchObject({ position: 'fixed', 'z-index': '55' })
  })

  it('keeps gold for "now": locked bell days and the statistic readout use neutral colors', () => {
    expect(getCssDeclarations(adminCss, '.admin-bell-tag.is-manual')).toMatchObject({ color: 'var(--ink)' })
    expect(getCssDeclarations(adminCss, '.admin-bell-legend-item.is-manual')).toMatchObject({ color: 'var(--ink)' })
    expect(getCssDeclarations(adminCss, '.admin-readout')).not.toHaveProperty('border-left')
    expect(adminCss).not.toMatch(/\.admin-bell-compact[^{]*\{[^}]*gold/)
  })

  it('shows the sync source, a special-schedule mark, and the tapped day on phone-width bell calendars', () => {
    expect(getCssDeclarations(adminCss, '.admin-bell-tag.is-ai, .admin-bell-compact.is-ai')).toMatchObject({ color: 'var(--success)' })
    expect(getCssDeclarations(adminCss, '.admin-bell-legend-item.is-special')).toMatchObject({ display: 'none' })
    expect(adminCss).toMatch(/@container \(max-width: 560px\) \{[\s\S]*?\.admin-bell-legend-item\.is-special \{\s*display: inline-flex;\s*\}\s*\.admin-bell-day-detail \{\s*display: grid;/)
  })

  it('lets confirmation messages read as the body text and drops the empty body', () => {
    expect(getCssDeclarations(adminCss, '.admin-confirm-dialog .dialog-body:empty')).toMatchObject({ display: 'none' })
    expect(getCssDeclarations(adminCss, '.admin-confirm-dialog .dialog-header p')).toMatchObject({ color: 'var(--ink-soft)', 'font-size': 'var(--text-md)' })
  })

  it('pins the phone section tabs under the top bar and uses gold only for the current section', () => {
    expect(getCssDeclarations(adminCss, '.admin-nav')).toMatchObject({ position: 'sticky', 'overflow-x': 'auto' })
    expect(getCssDeclarations(adminCss, '.admin-nav-item[aria-current="page"]::after')).toMatchObject({ background: 'var(--gold)' })
    expect(adminCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
