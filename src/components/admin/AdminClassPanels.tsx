import { AlertCircle, BookOpen, GraduationCap, Merge, Plus, Search, X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AcademicTerm, AdminClassRecord, AdminCourseNameRecord, DayType, MeetingSlot } from '../../lib/domain'
import { defaultDoubleMeetingSlots, hasMultiplePeriodsOnAnyDay, meetingSlotsForDay, sortMeetingSlots, validateMeetingSlots } from '../../lib/schedule'
import { teacherLastNameError } from '../../lib/teacher'
import { MeetingSlotEditor, preferredMeetingDay } from '../schedule/MeetingSlotEditor'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { useAdminDialogs } from './AdminDialogs'
import { AdminRowMenu } from './AdminRowMenu'
import { AdminSectionHeading } from './AdminSectionHeading'
import { formatTimestamp, IdText, plural, sentenceCase, TableSkeleton, useCopyToClipboard, type AdminActionRunner } from './adminShared'

/* Class sections, the course catalog, and their dialogs. */

// Database limits: course_names.name is 2–120 characters, aliases 2–160.
const COURSE_NAME_MAX_LENGTH = 120
const COURSE_ALIAS_MAX_LENGTH = 160

const classStatus: Record<AdminClassRecord['status'], { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'badge' },
  archived: { label: 'Archived', badge: 'badge badge-outline' },
  merged: { label: 'Merged', badge: 'badge badge-outline' },
}

const courseStatus: Record<AdminCourseNameRecord['status'], { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'badge' },
  disabled: { label: 'Disabled', badge: 'badge badge-danger' },
  merged: { label: 'Merged', badge: 'badge badge-outline' },
}

const courseSourceLabels: Record<AdminCourseNameRecord['source'], string> = {
  approved: 'Approved',
  legacy: 'Legacy',
  user: 'Added by a student',
  admin: 'Added by an administrator',
}

const aliasSourceLabels: Record<AdminCourseNameRecord['aliases'][number]['source'], string> = {
  admin: 'Added by an administrator',
  import_correction: 'Learned from import corrections',
  migration: 'Migration',
  system: 'System',
}

const termNames: Record<AcademicTerm, string> = {
  full_year: 'Full year',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
}

export function classEditErrorMessage(caught: unknown) {
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

function SlotNumerals({ slots }: { slots: MeetingSlot[] }) {
  const byPeriod = new Map<number, Set<DayType>>()
  for (const slot of slots) {
    const days = byPeriod.get(slot.period_number) ?? new Set<DayType>()
    days.add(slot.day_type)
    byPeriod.set(slot.period_number, days)
  }
  const entries = [...byPeriod.entries()].sort(([left], [right]) => left - right)
  if (entries.length === 0) return <span className="muted">No periods</span>
  return (
    <span className="admin-slots">
      {entries.map(([period, days]) => {
        const dayText = days.has('A') && days.has('B') ? 'A and B days' : days.has('A') ? 'A days' : 'B days'
        return (
          <span className="admin-slot" key={period}>
            <span className="period-numeral" aria-hidden="true">{period}</span>
            <span><span className="sr-only">Period {period}, </span>{dayText}</span>
          </span>
        )
      })}
    </span>
  )
}

/* ---------- Class sections ---------- */

export function ClassSectionsPanel({
  classes,
  courseNames,
  loaded,
  courseFilter,
  canonicalId,
  duplicateId,
  onCourseFilter,
  onCanonicalId,
  onDuplicateId,
  onEdit,
  onAdminAction,
}: {
  classes: AdminClassRecord[]
  courseNames: AdminCourseNameRecord[]
  loaded: boolean
  courseFilter: string | null
  canonicalId: string
  duplicateId: string
  onCourseFilter: (id: string | null) => void
  onCanonicalId: (id: string) => void
  onDuplicateId: (id: string) => void
  onEdit: (course: AdminClassRecord) => void
  onAdminAction: AdminActionRunner
}) {
  const dialogs = useAdminDialogs()
  const copy = useCopyToClipboard()
  const [search, setSearch] = useState('')
  const [merging, setMerging] = useState(false)
  const filteredByCourse = courseFilter ? classes.filter((course) => course.course_name_id === courseFilter) : classes
  const needle = search.trim().toLocaleLowerCase()
  const visibleClasses = needle
    ? filteredByCourse.filter((course) => course.course_name.toLocaleLowerCase().includes(needle) || course.teacher_last_name.toLocaleLowerCase().includes(needle) || course.id.startsWith(needle))
    : filteredByCourse
  const unusedClassCount = filteredByCourse.filter((course) => course.active_enrollment_count === 0).length
  const filterName = courseFilter ? courseNames.find((course) => course.id === courseFilter)?.course_name ?? 'one course' : null

  async function archive(course: AdminClassRecord) {
    const confirmed = await dialogs.confirm({
      title: `Archive ${course.course_name} with ${course.teacher_last_name}?`,
      message: 'Active enrollments will be deactivated, so the class leaves students’ schedules.',
      confirmLabel: 'Archive section',
      tone: 'danger',
    })
    if (confirmed) void onAdminAction('admin_archive_class', { p_class_id: course.id, p_reason: 'Archived from admin console' }, 'Class section archived.')
  }

  async function permanentlyDelete(course: AdminClassRecord) {
    if (course.active_enrollment_count > 0) {
      const count = course.active_enrollment_count
      const confirmed = await dialogs.confirm({
        title: `Delete ${course.course_name} with ${course.teacher_last_name}?`,
        message: <>{count} active student{count === 1 ? '' : 's'} {count === 1 ? 'is' : 'are'} currently enrolled. Deleting the section removes it from their schedules permanently.</>,
        confirmLabel: 'Delete permanently',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    void onAdminAction('admin_delete_class_section', { p_class_id: course.id, p_reason: 'Permanently deleted from admin console' }, `${course.course_name} was permanently deleted.`)
  }

  return (
    <section className="admin-section" aria-labelledby="admin-classes-title">
      <AdminSectionHeading
        id="admin-classes-title"
        title="Class sections"
        count={loaded ? plural(filteredByCourse.length, 'section') : undefined}
        description={<>Each section is one course with one teacher and default periods, shared by every student in it. {loaded ? <><strong>{unusedClassCount}</strong> {unusedClassCount === 1 ? 'section isn’t' : 'sections aren’t'} on anyone’s schedule.</> : null}</>}
        actions={<button className="button button-secondary button-sm" type="button" onClick={() => setMerging(true)}><Merge aria-hidden="true" />Merge duplicates</button>}
      />
      <div className="admin-toolbar">
        <div className="search-input admin-toolbar-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Filter sections by course or teacher" placeholder="Filter by course or teacher" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {courseFilter ? <span className="admin-filter-chip">
          <span>Only {filterName}</span>
          <button className="icon-button" type="button" aria-label="Show all sections" onClick={() => onCourseFilter(null)}><X aria-hidden="true" /></button>
        </span> : null}
      </div>
      {!loaded ? <TableSkeleton label="Loading class sections" /> : visibleClasses.length === 0
        ? <EmptyState icon={GraduationCap} title={needle || courseFilter ? 'No sections match' : 'No class sections yet'} action={needle || courseFilter ? <button className="button button-secondary" type="button" onClick={() => { setSearch(''); onCourseFilter(null) }}>Show all sections</button> : undefined}>
          {needle || courseFilter ? 'Try another course name or teacher.' : 'Sections appear when students add classes to their schedules.'}
        </EmptyState>
        : <div className="table-scroll admin-table-scroll">
          <table className="data-table admin-table">
            <thead>
              <tr><th scope="col">Course</th><th scope="col">Teacher</th><th scope="col">Meets</th><th scope="col">Students</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {visibleClasses.map((course) => (
                <tr key={course.id} className={course.active_enrollment_count === 0 ? 'is-unused' : undefined}>
                  <td className="admin-cell-primary">
                    <span className="admin-stacked-text">
                      <strong>{course.course_name}</strong>
                      <IdText value={course.id} />
                    </span>
                  </td>
                  <td data-label="Teacher">{course.teacher_last_name}</td>
                  <td data-label="Meets">
                    <span className="admin-stacked-text">
                      <SlotNumerals slots={course.meeting_slots} />
                      <small>{termNames[course.default_academic_term]}</small>
                    </span>
                  </td>
                  <td data-label="Students">
                    {course.active_enrollment_count === 0
                      ? <span className="muted">None</span>
                      : <span className="admin-stacked-text"><span className="numeric">{course.active_enrollment_count} active</span><small className="numeric">{course.total_enrollment_count} total</small></span>}
                  </td>
                  <td data-label="Status"><span className={classStatus[course.status].badge}>{classStatus[course.status].label}</span></td>
                  <td className="admin-cell-actions">
                    <span className="admin-row-actions">
                      {course.status === 'active' ? <button className="button button-secondary button-sm" type="button" aria-label={`Edit ${course.course_name} with ${course.teacher_last_name}`} onClick={() => onEdit(course)}>Edit</button> : null}
                      <AdminRowMenu label={`More actions for ${course.course_name} with ${course.teacher_last_name}`} items={[
                        { label: 'Copy section ID', onSelect: () => void copy(course.id, 'Section ID') },
                        'separator',
                        course.status === 'active' && { label: 'Archive section', onSelect: () => void archive(course) },
                        { label: 'Delete permanently', tone: 'danger', onSelect: () => void permanentlyDelete(course) },
                      ]} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {merging ? <MergeDialog
        title="Merge duplicate sections"
        description="Moves every enrollment from the duplicate section into the one you keep, then archives the duplicate."
        canonicalLabel="Section ID to keep"
        duplicateLabel="Duplicate section ID"
        submitLabel="Merge sections"
        canonical={canonicalId}
        duplicate={duplicateId}
        onCanonical={onCanonicalId}
        onDuplicate={onDuplicateId}
        onClose={() => setMerging(false)}
        onMerge={(onError) => onAdminAction('admin_merge_classes', { p_canonical_class_id: canonicalId, p_duplicate_class_id: duplicateId, p_reason: 'Duplicate class-section merge' }, 'Class sections merged transactionally.', { onError })}
      /> : null}
      {dialogs.dialog}
    </section>
  )
}

function MergeDialog({
  title,
  description,
  canonicalLabel,
  duplicateLabel,
  submitLabel,
  canonical,
  duplicate,
  onCanonical,
  onDuplicate,
  onClose,
  onMerge,
}: {
  title: string
  description: string
  canonicalLabel: string
  duplicateLabel: string
  submitLabel: string
  canonical: string
  duplicate: string
  onCanonical: (value: string) => void
  onDuplicate: (value: string) => void
  onClose: () => void
  onMerge: (onError: (message: string) => void) => Promise<boolean>
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canonical || !duplicate) return
    setBusy(true)
    setError(null)
    const merged = await onMerge(setError)
    setBusy(false)
    if (merged) onClose()
  }

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      dismissible={!busy}
      className="admin-dialog"
      footer={<>
        <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" form={formId} disabled={!canonical || !duplicate || busy}>{busy ? 'Merging…' : submitLabel}</button>
      </>}
    >
      <form id={formId} className="admin-dialog-form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor={`${formId}-canonical`}>{canonicalLabel}</label>
          <input id={`${formId}-canonical`} className="admin-mono-input" autoComplete="off" spellCheck={false} value={canonical} onChange={(event) => onCanonical(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-duplicate`}>{duplicateLabel}</label>
          <input id={`${formId}-duplicate`} className="admin-mono-input" autoComplete="off" spellCheck={false} value={duplicate} onChange={(event) => onDuplicate(event.target.value)} />
        </div>
        <p className="field-help">Copy IDs from each row’s actions menu. This can’t be undone from here.</p>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
      </form>
    </Dialog>
  )
}

/* ---------- Course catalog ---------- */

export function CourseCatalogPanel({
  courseNames,
  loaded,
  onViewSections,
  onAdminAction,
}: {
  courseNames: AdminCourseNameRecord[]
  loaded: boolean
  onViewSections: (id: string) => void
  onAdminAction: AdminActionRunner
}) {
  const dialogs = useAdminDialogs()
  const copy = useCopyToClipboard()
  const [, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [canonicalCourseNameId, setCanonicalCourseNameId] = useState('')
  const [duplicateCourseNameId, setDuplicateCourseNameId] = useState('')
  const [merging, setMerging] = useState(false)
  const [aliasCourseId, setAliasCourseId] = useState<string | null>(null)
  const selectedAliasCourse = courseNames.find((course) => course.id === aliasCourseId) ?? null
  const needle = search.trim().toLocaleLowerCase()
  const visible = useMemo(() => needle
    ? courseNames.filter((course) => course.course_name.toLocaleLowerCase().includes(needle) || course.aliases.some((alias) => alias.alias.toLocaleLowerCase().includes(needle)) || course.id.startsWith(needle))
    : courseNames, [courseNames, needle])

  function viewSections(courseName: AdminCourseNameRecord) {
    onViewSections(courseName.id)
    setSearchParams({ section: 'classes' }, { replace: true })
  }

  async function addCourseName() {
    const name = (await dialogs.prompt({
      title: 'Add a course name',
      description: 'Students can pick it when they add a class. Use the official name from the course catalog.',
      label: 'Course name',
      maxLength: COURSE_NAME_MAX_LENGTH,
      submitLabel: 'Add course name',
    }))?.trim()
    if (!name) return
    void onAdminAction('admin_create_course_name', { p_name: name, p_reason: 'Added from admin course catalog' }, `${name} was added to the course catalog.`)
  }

  async function renameCourseName(courseName: AdminCourseNameRecord) {
    const name = (await dialogs.prompt({
      title: `Rename ${courseName.course_name}`,
      description: 'Every section and schedule linked to this course shows the new name.',
      label: 'Course name',
      defaultValue: courseName.course_name,
      maxLength: COURSE_NAME_MAX_LENGTH,
      submitLabel: 'Rename course',
    }))?.trim()
    if (!name || name === courseName.course_name) return
    void onAdminAction('admin_rename_course_name', { p_course_name_id: courseName.id, p_name: name, p_reason: 'Renamed from admin course catalog' }, `${courseName.course_name} was renamed to ${name}.`)
  }

  async function toggleEnabled(courseName: AdminCourseNameRecord) {
    const enabling = courseName.status !== 'active'
    const confirmed = await dialogs.confirm({
      title: `${enabling ? 'Enable' : 'Disable'} ${courseName.course_name}?`,
      message: <>{enabling ? 'Students will be able to pick it again.' : 'Students can no longer pick it.'} Existing schedules keep their linked name.</>,
      confirmLabel: enabling ? 'Enable course' : 'Disable course',
      tone: enabling ? 'default' : 'danger',
    })
    if (confirmed) void onAdminAction('admin_set_course_name_enabled', { p_course_name_id: courseName.id, p_enabled: enabling, p_reason: `${enabling ? 'Enabled' : 'Disabled'} from admin course catalog` }, `${courseName.course_name} was ${enabling ? 'enabled' : 'disabled'}.`)
  }

  async function deleteCourseAlias(courseName: AdminCourseNameRecord, aliasId: string, alias: string, onError: (message: string) => void) {
    const confirmed = await dialogs.confirm({
      title: `Remove “${alias}”?`,
      message: <>The importer and catalog search will stop matching it to {courseName.course_name}.</>,
      confirmLabel: 'Remove name',
      tone: 'danger',
    })
    if (!confirmed) return false
    // The "Possible names" dialog stays open, so a failure is shown there
    // rather than on the page behind it.
    return onAdminAction('admin_delete_course_name_alias', {
      p_alias_id: aliasId,
      p_reason: 'Removed from admin course catalog',
    }, `${alias} was removed from ${courseName.course_name}.`, { onError })
  }

  return (
    <section className="admin-section" aria-labelledby="admin-catalog-title">
      <AdminSectionHeading
        id="admin-catalog-title"
        title="Course catalog"
        count={loaded ? plural(courseNames.length, 'course') : undefined}
        description="The approved course names students choose from. Every class section links to one of these names."
        actions={<>
          <button className="button button-secondary button-sm" type="button" onClick={() => setMerging(true)}><Merge aria-hidden="true" />Merge duplicates</button>
          <button className="button button-primary button-sm" type="button" onClick={() => void addCourseName()}><Plus aria-hidden="true" />Add course name</button>
        </>}
      />
      <div className="admin-toolbar">
        <div className="search-input admin-toolbar-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Filter courses" placeholder="Filter by name or possible name" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      {!loaded ? <TableSkeleton label="Loading course catalog" /> : visible.length === 0
        ? <EmptyState icon={BookOpen} title={needle ? 'No courses match' : 'The catalog is empty'} action={needle ? <button className="button button-secondary" type="button" onClick={() => setSearch('')}>Clear filter</button> : undefined}>
          {needle ? 'Try another name.' : 'Add the first course name so students can build schedules.'}
        </EmptyState>
        : <div className="table-scroll admin-table-scroll">
          <table className="data-table admin-table">
            <thead>
              <tr><th scope="col">Course name</th><th scope="col">Source</th><th scope="col">Sections</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {visible.map((courseName) => (
                <tr key={courseName.id}>
                  <td className="admin-cell-primary">
                    <span className="admin-stacked-text">
                      <strong>{courseName.course_name}</strong>
                      <small>{courseName.alias_count > 0 ? plural(courseName.alias_count, 'possible name') : 'No other names'}</small>
                      <IdText value={courseName.id} />
                    </span>
                  </td>
                  <td data-label="Source">{courseSourceLabels[courseName.source] ?? sentenceCase(courseName.source)}</td>
                  <td data-label="Sections"><span className="admin-stacked-text"><span className="numeric">{courseName.active_section_count} active</span><small className="numeric">{courseName.section_count} total</small></span></td>
                  <td data-label="Status"><span className={courseStatus[courseName.status].badge}>{courseStatus[courseName.status].label}</span></td>
                  <td className="admin-cell-actions">
                    <span className="admin-row-actions">
                      <button className="button button-secondary button-sm" type="button" aria-label={`View sections of ${courseName.course_name}`} onClick={() => viewSections(courseName)}>Sections</button>
                      <AdminRowMenu label={`More actions for ${courseName.course_name}`} items={[
                        { label: 'Copy course ID', onSelect: () => void copy(courseName.id, 'Course ID') },
                        courseName.status !== 'merged' && 'separator',
                        courseName.status !== 'merged' && { label: 'Possible names', onSelect: () => setAliasCourseId(courseName.id) },
                        courseName.status !== 'merged' && { label: 'Rename', onSelect: () => void renameCourseName(courseName) },
                        courseName.status !== 'merged' && (courseName.status === 'active'
                          ? { label: 'Disable', tone: 'danger', onSelect: () => void toggleEnabled(courseName) }
                          : { label: 'Enable', onSelect: () => void toggleEnabled(courseName) }),
                      ]} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}

      {selectedAliasCourse ? <CourseAliasDialog
        course={selectedAliasCourse}
        onClose={() => setAliasCourseId(null)}
        onAdd={(alias, onError) => onAdminAction('admin_add_course_name_alias', {
          p_course_name_id: selectedAliasCourse.id,
          p_alias: alias,
          p_reason: 'Added from admin course catalog',
        }, `${alias} will now match ${selectedAliasCourse.course_name}.`, { onError })}
        onRemove={(aliasId, alias, onError) => deleteCourseAlias(selectedAliasCourse, aliasId, alias, onError)}
      /> : null}
      {merging ? <MergeDialog
        title="Merge duplicate course names"
        description="Relinks every section to the course name you keep and marks the duplicate as merged. Sections stay separate."
        canonicalLabel="Course ID to keep"
        duplicateLabel="Duplicate course ID"
        submitLabel="Merge course names"
        canonical={canonicalCourseNameId}
        duplicate={duplicateCourseNameId}
        onCanonical={setCanonicalCourseNameId}
        onDuplicate={setDuplicateCourseNameId}
        onClose={() => setMerging(false)}
        onMerge={(onError) => onAdminAction('admin_merge_course_names', { p_canonical_course_name_id: canonicalCourseNameId, p_duplicate_course_name_id: duplicateCourseNameId, p_reason: 'Duplicate course-name merge' }, 'Course names merged without merging sections.', { onError })}
      /> : null}
      {dialogs.dialog}
    </section>
  )
}

function CourseAliasDialog({ course, onClose, onAdd, onRemove }: {
  course: AdminCourseNameRecord
  onClose: () => void
  onAdd: (alias: string, onError: (message: string) => void) => Promise<boolean>
  /** Resolves true once the name is removed; false when cancelled or failed. */
  onRemove: (aliasId: string, alias: string, onError: (message: string) => void) => Promise<boolean>
}) {
  const fieldId = useId()
  const fieldRef = useRef<HTMLInputElement>(null)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(aliasId: string, name: string) {
    setError(null)
    const removed = await onRemove(aliasId, name, setError)
    // Its Remove button is gone with the row; keep focus inside the dialog.
    if (removed) fieldRef.current?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = alias.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    const added = await onAdd(trimmed, setError)
    setBusy(false)
    if (added) setAlias('')
  }

  return (
    <Dialog
      title={`Possible names for ${course.course_name}`}
      description="The importer and catalog search accept these names but always show the official course name."
      onClose={onClose}
      className="admin-dialog"
      footer={<button className="button button-secondary" type="button" onClick={onClose}>Done</button>}
    >
      <form className="admin-inline-form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor={fieldId}>Add a possible name</label>
          <div className="admin-inline-form-row">
            <input id={fieldId} ref={fieldRef} value={alias} maxLength={COURSE_ALIAS_MAX_LENGTH} disabled={busy} placeholder="For example, AP Lang" onChange={(event) => setAlias(event.target.value)} />
            <button className="button button-primary" type="submit" disabled={!alias.trim() || busy}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
        </div>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
      </form>
      {course.aliases.length === 0
        ? <p className="empty-inline">No other names yet. Names are also learned when students correct imports.</p>
        : <ul className="list">
          {course.aliases.map((item) => (
            <li className="list-row admin-alias-row" key={item.id}>
              <span className="admin-stacked-text">
                <strong>{item.alias}</strong>
                <small>{aliasSourceLabels[item.source] ?? sentenceCase(item.source)}</small>
                <small>Matched {plural(item.learned_count, 'time')}. Last seen {formatTimestamp(item.last_seen_at, 'never')}.</small>
              </span>
              <button className="button button-secondary button-sm button-danger-outline" type="button" aria-label={`Remove ${item.alias}`} onClick={() => void remove(item.id, item.alias)}>Remove</button>
            </li>
          ))}
        </ul>}
    </Dialog>
  )
}

/* ---------- Class edit dialog ---------- */

export function AdminClassEditDialog({
  course,
  courseNames,
  saving,
  error,
  onClose,
  onSave,
}: {
  course: AdminClassRecord
  courseNames: AdminCourseNameRecord[]
  saving: boolean
  error?: string | null
  onClose: () => void
  onSave: (input: { courseNameId: string; teacherLastName: string; term: AcademicTerm; isDoublePeriod: boolean; meetingSlots: MeetingSlot[]; reason: string }) => Promise<void>
}) {
  const formId = useId()
  const [courseNameId, setCourseNameId] = useState(course.course_name_id)
  const [teacherLastName, setTeacherLastName] = useState(course.teacher_last_name)
  const term = course.default_academic_term
  const [isDoublePeriod, setIsDoublePeriod] = useState(course.is_double_period || hasMultiplePeriodsOnAnyDay(course.meeting_slots))
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(course.meeting_slots)
  const [reason, setReason] = useState('Corrected from admin class management')
  const slotError = validateMeetingSlots(meetingSlots, isDoublePeriod)
  const teacherError = teacherLastNameError(teacherLastName)
  const canSave = Boolean(courseNameId) && !teacherError && reason.trim().length >= 3 && !slotError

  function changeDoublePeriod(nextIsDoublePeriod: boolean) {
    setIsDoublePeriod(nextIsDoublePeriod)
    if (!nextIsDoublePeriod) {
      const normalSlots = (['A', 'B'] as const).flatMap((day) => meetingSlotsForDay(meetingSlots, day).slice(0, 1))
      setMeetingSlots(sortMeetingSlots(normalSlots))
      return
    }
    if (hasMultiplePeriodsOnAnyDay(meetingSlots)) return
    setMeetingSlots(defaultDoubleMeetingSlots(preferredMeetingDay(meetingSlots), meetingSlots[0]?.period_number ?? 1))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    void onSave({ courseNameId, teacherLastName, term, isDoublePeriod, meetingSlots, reason })
  }

  const count = course.active_enrollment_count
  return (
    <Dialog
      title="Edit class section"
      description={`${count} active enrollment${count === 1 ? '' : 's'} will receive this update.`}
      onClose={onClose}
      dismissible={!saving}
      className="admin-dialog admin-class-dialog"
      footer={<>
        <button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" form={formId} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save class changes'}</button>
      </>}
    >
      <form id={formId} className="admin-dialog-form" onSubmit={submit}>
        <div className="admin-field-grid">
          <div className="field">
            <label htmlFor={`${formId}-course`}>Course name</label>
            <select id={`${formId}-course`} required value={courseNameId} onChange={(event) => setCourseNameId(event.target.value)}>{courseNames.filter((item) => item.status === 'active' || item.id === course.course_name_id).map((item) => <option value={item.id} key={item.id}>{item.course_name}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor={`${formId}-teacher`}>Teacher last name</label>
            <input id={`${formId}-teacher`} required maxLength={120} value={teacherLastName} aria-invalid={teacherError ? true : undefined} aria-describedby={`${formId}-teacher-help`} onChange={(event) => setTeacherLastName(event.target.value)} />
            <p className="field-help" id={`${formId}-teacher-help`}>Last name only. Compound last names are fine.</p>
          </div>
        </div>
        {teacherError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{teacherError}</p> : null}
        <dl className="facts admin-facts">
          <dt>Academic term</dt>
          <dd>{termNames[term]}<span className="field-help admin-fact-help">Terms are fixed after a section is created. Create a new section to use a different term.</span></dd>
        </dl>
        <MeetingSlotEditor isDoublePeriod={isDoublePeriod} meetingSlots={meetingSlots} onDoublePeriodChange={changeDoublePeriod} onMeetingSlotsChange={setMeetingSlots} />
        {slotError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{slotError}</p> : null}
        <div className="field">
          <label htmlFor={`${formId}-reason`}>Audit reason</label>
          <input id={`${formId}-reason`} required maxLength={2000} value={reason} aria-describedby={`${formId}-reason-help`} onChange={(event) => setReason(event.target.value)} />
          <p className="field-help" id={`${formId}-reason-help`}>Recorded in the audit log with this change.</p>
        </div>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
      </form>
    </Dialog>
  )
}
