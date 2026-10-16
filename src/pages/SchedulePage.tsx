import { AlertCircle, AlertTriangle, CheckCircle2, ImagePlus, Pencil, RefreshCw, Share2, Trash2, Users, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { AddClassDialog } from '../components/schedule/AddClassDialog'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { ScheduleImportDialog, type ScheduleImportClarification } from '../components/schedule/ScheduleImportDialog'
import { classCoveringHiddenEnrollment, conflictsInTerm } from '../components/schedule/termConflicts'
import { TermSelector } from '../components/schedule/TermSelector'
import { Dialog } from '../components/ui/Dialog'
import { PageHeader } from '../components/ui/PageHeader'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import { useBellSchedule } from '../features/bell/BellScheduleProvider'
import { shareScheduleLink } from '../features/share/shareSchedule'
import { useDialogAccessibility } from '../hooks/useDialogAccessibility'
import { useNow } from '../hooks/useNow'
import { useSchedule } from '../hooks/useSchedule'
import { resolveBellNow } from '../lib/bellSchedule'
import type { ClassDefinition, DayType, ScheduleEnrollment, SemesterTerm } from '../lib/domain'
import { courseTermPolicy, enrollmentMeetingSlots, isLunchCourse, sortMeetingSlots } from '../lib/schedule'
import {
  clearGuestScheduleImportDraft,
  confirmScheduleImport,
  editableRowsFromImportResult,
  findGuestClassesForCourse,
  loadGuestScheduleImportDraft,
  normalizeImportedResultForGrade,
  saveGuestScheduleImportDraft,
  scheduleImportPreviewEnrollments,
  type ScheduleImportResult,
} from '../lib/scheduleImport'
import { clearSchedule, removeEnrollment, searchGuestCourseNames } from '../lib/supabase/data'
import { scheduleCoverageIssues } from '../lib/scheduleEngineRules'

/** The period being edited. The semester is captured when the dialog opens so it cannot shift underneath it. */
interface ActiveCell { dayType: DayType; period: number; semester: SemesterTerm; replacing?: ScheduleEnrollment | null }

const semesterNames: Record<SemesterTerm, string> = { semester_1: 'Semester 1', semester_2: 'Semester 2' }

function classCount(count: number): string {
  return `${count} ${count === 1 ? 'class' : 'classes'}`
}

function ClarificationCallout({ count, onReview, onDismiss }: { count: number; onReview: () => void; onDismiss: () => void }) {
  const titleId = useId()
  return (
    <section className="notice notice-warning schedule-callout" aria-labelledby={titleId}>
      <AlertTriangle aria-hidden="true" />
      <div className="schedule-callout-text">
        <h2 id={titleId}>{count} imported {count === 1 ? 'class needs' : 'classes need'} your review</h2>
        <p>The importer wasn’t sure about {count === 1 ? 'it' : 'them'}. Everything else made it onto your schedule.</p>
      </div>
      <div className="schedule-callout-actions">
        <button className="button button-secondary button-sm" type="button" onClick={onReview}>Review classes</button>
      </div>
      <button className="icon-button schedule-callout-dismiss" type="button" aria-label="Dismiss clarification reminder" onClick={onDismiss}><X aria-hidden="true" /></button>
    </section>
  )
}

/**
 * Asked once, right after an import that left classes unresolved. It is an
 * alert dialog because the student has to pick a path before continuing.
 */
function ImportIssueChoiceDialog({ count, onFix, onManual }: { count: number; onFix: () => void; onManual: () => void }) {
  const dialogRef = useDialogAccessibility(true, onManual)
  const fixButtonRef = useRef<HTMLButtonElement | null>(null)
  // "Add it myself" discards the saved clarification, so a reflexive Enter
  // must open the fixer instead. Runs after the dialog hook's own focus.
  useEffect(() => { fixButtonRef.current?.focus() }, [])
  const pronoun = count === 1 ? 'it' : 'them'
  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog is-small schedule-issue-dialog" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="import-issue-choice-title" aria-describedby="import-issue-choice-description" tabIndex={-1}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="dialog-body schedule-issue-body">
          <span className="schedule-issue-icon"><AlertTriangle aria-hidden="true" /></span>
          <h2 id="import-issue-choice-title">{classCount(count)} couldn’t be imported</h2>
          <p id="import-issue-choice-description">The rest of your schedule was imported. Fix what the importer missed now, or add the remaining {count === 1 ? 'class' : 'classes'} yourself.</p>
        </div>
        <footer className="dialog-footer">
          <button className="button button-secondary" type="button" onClick={onManual}>Add {pronoun} myself</button>
          <button className="button button-primary" type="button" ref={fixButtonRef} onClick={onFix}>Fix {pronoun} now</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

function OpenScheduleSlotsNote({ enrollments }: { enrollments: ScheduleEnrollment[] }) {
  if (enrollments.length === 0) return null
  const completeEnrollments = enrollments.filter((enrollment) => Boolean(
    enrollment.academic_term
    && enrollment.class
    && (enrollment.meeting_slots ?? enrollment.class.meeting_slots),
  ))
  const coverageIssues = scheduleCoverageIssues(completeEnrollments)
  const openSlotCounts = (['semester_1', 'semester_2'] as const).map((term) => ({
    term,
    count: coverageIssues.filter((issue) => issue.term === term && issue.count === 0).length,
  })).filter((summary) => summary.count > 0)
  if (openSlotCounts.length === 0) {
    return <p className="schedule-open-slots-note is-complete"><CheckCircle2 aria-hidden="true" />Every period is filled in for both semesters.</p>
  }
  const openSlotCount = openSlotCounts.reduce((total, summary) => total + summary.count, 0)
  const where = openSlotCounts.length === 1 ? `in ${semesterNames[openSlotCounts[0].term]}` : 'across both semesters'
  return <p className="schedule-open-slots-note"><strong className="numeric">{openSlotCount}</strong> open {openSlotCount === 1 ? 'period' : 'periods'} {where}</p>
}

interface ConflictNoticeProps {
  enrollments: ScheduleEnrollment[]
  term: SemesterTerm
  onReplace: (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => void
  onRemove: (enrollment: ScheduleEnrollment) => void
}

function ConflictNotice({ enrollments, term, onReplace, onRemove }: ConflictNoticeProps) {
  const pairs = conflictsInTerm(enrollments, term)
  if (pairs.length === 0) return null
  // A class that shares every period with another has no cell in the grid,
  // so its actions live here instead.
  const hidden = [...new Map(pairs.flat().map((enrollment) => [enrollment.id, enrollment])).values()].flatMap((enrollment) => {
    const coveredBy = classCoveringHiddenEnrollment(enrollments, enrollment, term)
    return coveredBy ? [{ enrollment, coveredBy }] : []
  })
  const [[first, second]] = pairs
  const isLunch = (enrollment: ScheduleEnrollment) => courseTermPolicy(enrollment.class) === 'lunch' || isLunchCourse(enrollment.class.course_name)
  const summary = pairs.length > 1
    ? `${pairs.length} pairs of classes conflict.`
    : isLunch(first) && isLunch(second)
      ? `${first.class.course_name} and ${second.class.course_name} are both lunches.`
      : `${first.class.course_name} and ${second.class.course_name} are scheduled at the same time.`
  return (
    <div className="notice notice-warning schedule-conflict-notice">
      <AlertTriangle aria-hidden="true" />
      <div className="schedule-conflict-text">
        <p><strong>{summary}</strong> Open a class marked “Conflict” to change or remove it.</p>
        {hidden.length > 0 ? (
          <ul className="schedule-conflict-hidden">
            {hidden.map(({ enrollment, coveredBy }) => {
              const name = enrollment.class.course_name
              const [firstSlot] = sortMeetingSlots(enrollmentMeetingSlots(enrollment))
              return (
                <li key={enrollment.id}>
                  <span>{name} isn’t shown in the grid because it shares a period with {coveredBy.class.course_name}.</span>
                  <span className="schedule-conflict-actions">
                    <button className="button button-secondary button-sm" type="button" aria-label={`Edit or replace ${name}`} onClick={() => onReplace(enrollment, firstSlot.day_type, firstSlot.period_number)}><Pencil aria-hidden="true" />Edit</button>
                    <button className="button button-danger-outline button-sm" type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(enrollment)}><Trash2 aria-hidden="true" />Remove</button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function ErrorNotice({ children, onDismiss, action }: { children: ReactNode; onDismiss?: () => void; action?: ReactNode }) {
  return (
    <div className="notice notice-danger schedule-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <div className="schedule-error-text">{children}</div>
      {action}
      {onDismiss ? <button className="icon-button" type="button" aria-label="Dismiss message" onClick={onDismiss}><X aria-hidden="true" /></button> : null}
    </div>
  )
}

function onboardingKey(userId: string): string {
  return `scheduleshare:schedule-onboarding:${userId}`
}

function clarificationKey(ownerId: string): string {
  return `scheduleshare:schedule-import-clarification:v1:${ownerId}`
}

function loadClarification(ownerId: string): ScheduleImportClarification | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(clarificationKey(ownerId)) ?? 'null') as Partial<ScheduleImportClarification> | null
    if (!parsed || !Array.isArray(parsed.rowIds) || !parsed.result || !Array.isArray(parsed.result.rows)) return null
    return parsed as ScheduleImportClarification
  } catch {
    return null
  }
}

function saveClarification(ownerId: string, clarification: ScheduleImportClarification): void {
  try {
    window.localStorage.setItem(clarificationKey(ownerId), JSON.stringify(clarification))
  } catch {
    // The in-memory reminder remains available when optional storage is unavailable.
  }
}

function clearClarification(ownerId: string): void {
  try {
    window.localStorage.removeItem(clarificationKey(ownerId))
  } catch {
    // The in-memory reminder is still cleared.
  }
}

function normalizedImportedCourseName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\(\s*chs\s*\)/g, ' ')
    .replace(/\bhon\b/g, 'honors')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function clarificationRowWasAddedManually(
  row: ScheduleImportResult['rows'][number],
  enrollments: ScheduleEnrollment[],
): boolean {
  const sourceName = normalizedImportedCourseName(row.course?.name ?? row.source_course_name)
  return enrollments.some((enrollment) => enrollment.active && (
    row.course?.id
      ? enrollment.class.course_name_id === row.course.id
      : normalizedImportedCourseName(enrollment.class.course_name) === sourceName
  ))
}

function rememberOnboarding(userId: string, state: 'dismissed' | 'completed'): void {
  try {
    window.localStorage.setItem(onboardingKey(userId), state)
  } catch {
    // Storage preferences are nonessential; the saved schedule still prevents reopening.
  }
}

function hasHandledOnboarding(userId: string): boolean {
  try {
    return window.localStorage.getItem(onboardingKey(userId)) !== null
  } catch {
    return false
  }
}

function shareCtaKey(userId: string): string {
  return `scheduleshare:share-cta-dismissed:${userId}`
}

function hasDismissedShareCta(userId: string): boolean {
  try {
    return window.localStorage.getItem(shareCtaKey(userId)) === 'true'
  } catch {
    return false
  }
}

function rememberShareCtaDismissal(userId: string): void {
  try {
    window.localStorage.setItem(shareCtaKey(userId), 'true')
  } catch {
    // The reminder can reappear if optional local storage is unavailable.
  }
}

function importSavedMessage(added: number, removed: number): string {
  return removed > 0
    ? `Schedule saved: ${classCount(added)} added, ${classCount(removed)} from before removed.`
    : `Schedule saved: ${classCount(added)} added.`
}

/** Where today falls in the bell calendar, for the grid's "Today" and "Now" marks. */
function useScheduleToday() {
  const { days } = useBellSchedule()
  const now = useNow(30_000)
  const bell = resolveBellNow(now, days)
  return {
    /** Today's day, or the next school day when there is no school today. */
    upcomingDayType: bell.day?.day_type ?? null,
    upcomingSemester: bell.day?.semester ?? null,
    todayDayType: bell.isToday ? bell.day?.day_type ?? null : null,
    todaySemester: bell.isToday ? bell.day?.semester ?? null : null,
    currentPeriod: bell.isToday && bell.state === 'in_block' && bell.current?.kind === 'class' ? bell.current.period_number : null,
  }
}

/**
 * Whether the loading skeleton should replace the page. Only a student's first
 * load does; later reloads (after an add, edit, removal, clear or import) keep
 * the page mounted so open dialogs, the scroll position, and the day picked on
 * a phone survive them.
 */
function useFirstScheduleLoad(loading: boolean, ownerId: string | null): boolean {
  // The student whose settled state counts as loaded. At mount that is the
  // current student. After signing in on this page it is only set once their
  // load is seen starting, because the first render after sign-in still
  // carries the signed-out, settled state.
  const [trackedFor, setTrackedFor] = useState<string | null>(ownerId)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  if (!ownerId) {
    if (trackedFor !== null) setTrackedFor(null)
    if (loadedFor !== null) setLoadedFor(null)
    return loading
  }
  if (loading && trackedFor !== ownerId) setTrackedFor(ownerId)
  if (!loading && trackedFor === ownerId && loadedFor !== ownerId) setLoadedFor(ownerId)
  return loading && loadedFor !== ownerId
}

function ScheduleSkeleton() {
  return (
    <div className="page schedule-page" aria-busy="true">
      <PageHeader title="My schedule" />
      <div className="schedule-loading" role="status" aria-label="Loading your schedule…">
        <span className="skeleton schedule-loading-toolbar" />
        <span className="skeleton schedule-loading-grid" />
      </div>
    </div>
  )
}

export function SchedulePage() {
  const { user, profile, isAdmin, isDemo } = useAuth()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const { showToast } = useToast()
  const schedule = useSchedule()
  const reloadSchedule = schedule.reload
  const showScheduleSkeleton = useFirstScheduleLoad(schedule.loading, user?.id ?? null)
  const today = useScheduleToday()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pickedTerm, setPickedTerm] = useState<SemesterTerm | null>(null)
  const selectedTerm: SemesterTerm = pickedTerm ?? today.upcomingSemester ?? 'semester_1'
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importOnboarding, setImportOnboarding] = useState(false)
  const [guestImportResult, setGuestImportResult] = useState<ScheduleImportResult | null>(null)
  const clarificationOwnerId = user?.id ?? 'guest'
  const [clarification, setClarification] = useState<ScheduleImportClarification | null>(() => loadClarification(clarificationOwnerId))
  const [clarificationPromptOpen, setClarificationPromptOpen] = useState(false)
  const [clarificationOpen, setClarificationOpen] = useState(false)
  const [clearScheduleOpen, setClearScheduleOpen] = useState(false)
  const [clearingSchedule, setClearingSchedule] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareCtaDismissed, setShareCtaDismissed] = useState(() => user ? hasDismissedShareCta(user.id) : true)
  const introHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const scheduleBoardRef = useRef<HTMLElement | null>(null)
  const focusIntroAfterClear = useRef(false)
  const onboardingCheckedFor = useRef<string | null>(null)
  const guestTransferStartedFor = useRef<string | null>(null)
  const guestPreviewEnrollments = useMemo(
    () => guestImportResult ? scheduleImportPreviewEnrollments(guestImportResult) : [],
    [guestImportResult],
  )
  const termIsToday = today.todaySemester === selectedTerm
  const gridTodayProps = {
    todayDayType: termIsToday ? today.todayDayType : null,
    currentPeriod: termIsToday ? today.currentPeriod : null,
    defaultMobileDay: today.upcomingDayType,
  }

  useEffect(() => {
    setClarification(loadClarification(clarificationOwnerId))
    setClarificationPromptOpen(false)
    setClarificationOpen(false)
  }, [clarificationOwnerId])

  const updateClarification = useCallback((next: ScheduleImportClarification) => {
    saveClarification(clarificationOwnerId, next)
    setClarification(next)
  }, [clarificationOwnerId])

  const startClarification = useCallback((next: ScheduleImportClarification) => {
    updateClarification(next)
    setClarificationOpen(false)
    setClarificationPromptOpen(true)
  }, [updateClarification])

  const finishClarification = useCallback(() => {
    clearClarification(clarificationOwnerId)
    setClarification(null)
    setClarificationPromptOpen(false)
    setClarificationOpen(false)
  }, [clarificationOwnerId])

  useEffect(() => {
    if (!clarification || schedule.loading) return
    const remainingRowIds = clarification.rowIds.filter((rowId) => {
      const row = clarification.result.rows.find((candidate) => candidate.id === rowId)
      return !row || !clarificationRowWasAddedManually(row, schedule.enrollments)
    })
    if (remainingRowIds.length === clarification.rowIds.length) return
    if (remainingRowIds.length === 0) {
      finishClarification()
      return
    }
    updateClarification({ ...clarification, rowIds: remainingRowIds })
  }, [clarification, finishClarification, schedule.enrollments, schedule.loading, updateClarification])

  useEffect(() => {
    setShareCtaDismissed(user ? hasDismissedShareCta(user.id) : true)
  }, [user])

  // The clear button disappears with the last class, so focus moves to the
  // intro that replaces the grid's contents instead of falling to the page.
  useEffect(() => {
    if (!focusIntroAfterClear.current || clearScheduleOpen || schedule.enrollments.length > 0) return
    focusIntroAfterClear.current = false
    introHeadingRef.current?.focus()
  }, [clearScheduleOpen, schedule.enrollments.length])

  useEffect(() => {
    if (!user || schedule.loading) return
    if (schedule.enrollments.length > 0) {
      onboardingCheckedFor.current = user.id
      rememberOnboarding(user.id, 'completed')
      return
    }
    if (searchParams.get('import') === '1') {
      onboardingCheckedFor.current = user.id
      setImportOnboarding(false)
      setImportOpen(true)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('import')
      setSearchParams(nextParams, { replace: true })
      return
    }
    if (loadGuestScheduleImportDraft()) {
      onboardingCheckedFor.current = user.id
      return
    }
    if (onboardingCheckedFor.current === user.id) return
    onboardingCheckedFor.current = user.id
    if (!hasHandledOnboarding(user.id)) {
      setImportOnboarding(true)
      setImportOpen(true)
    }
  }, [schedule.enrollments.length, schedule.loading, searchParams, setSearchParams, user])

  useEffect(() => {
    if (user || searchParams.get('import') !== '1') return
    setImportOnboarding(false)
    setImportOpen(true)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('import')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams, user])

  useEffect(() => {
    if (user || guestImportResult) return
    const draft = loadGuestScheduleImportDraft()
    if (draft) setGuestImportResult(draft)
  }, [guestImportResult, user])

  useEffect(() => {
    if (!user
      || !profile?.grade
      || !profile.onboarding_completed
      || schedule.loading
      || schedule.enrollments.length > 0
      || guestTransferStartedFor.current === user.id) return
    const draft = loadGuestScheduleImportDraft()
    if (!draft) return
    guestTransferStartedFor.current = user.id
    const grade = profile.grade
    const removeLegacyResumeMarker = () => {
      if (searchParams.get('import') !== 'resume') return
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('import')
      setSearchParams(nextParams, { replace: true })
    }
    void (async () => {
      const normalizedResult = await normalizeImportedResultForGrade(draft, grade)
      const saved = await confirmScheduleImport(editableRowsFromImportResult(normalizedResult))
      await reloadSchedule()
      clearGuestScheduleImportDraft()
      setGuestImportResult(null)
      rememberOnboarding(user.id, 'completed')
      showToast(`Your imported schedule was saved: ${classCount(saved.added)} added.`)
      removeLegacyResumeMarker()
    })().catch((caught: unknown) => {
      setPageError(caught instanceof Error
        ? `Your imported schedule is still here, but it couldn’t be saved automatically: ${caught.message}`
        : 'Your imported schedule is still here, but it couldn’t be saved automatically.')
      removeLegacyResumeMarker()
    })
  }, [profile?.grade, profile?.onboarding_completed, reloadSchedule, schedule.enrollments.length, schedule.loading, searchParams, setSearchParams, showToast, user])

  async function remove(enrollment: ScheduleEnrollment) {
    try {
      if (isDemo) schedule.removeDemoEnrollment(enrollment.id)
      else {
        await removeEnrollment(enrollment.id)
        await schedule.reload()
      }
      setPageError(null)
      showToast(`${enrollment.class.course_name} was removed from your schedule.`)
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : 'The class couldn’t be removed from your schedule. Try again.')
    }
  }

  async function clearAllClasses() {
    if (clearingSchedule) return
    setClearingSchedule(true)
    setClearError(null)
    try {
      const removed = isDemo
        ? schedule.enrollments.reduce((count, enrollment) => {
          schedule.removeDemoEnrollment(enrollment.id)
          return count + 1
        }, 0)
        : await clearSchedule()
      if (!isDemo) await schedule.reload()
      focusIntroAfterClear.current = true
      setClearScheduleOpen(false)
      showToast(`Schedule cleared: ${classCount(removed)} removed.`)
    } catch (caught) {
      setClearError(caught instanceof Error ? caught.message : 'Your schedule couldn’t be cleared. Try again.')
    } finally {
      setClearingSchedule(false)
    }
  }

  async function shareSchedule(): Promise<boolean> {
    setSharing(true)
    try {
      const result = await shareScheduleLink()
      if (result === 'cancelled') return false
      showToast(result === 'shared' ? 'Schedule shared.' : 'Schedule link copied.')
      setPageError(null)
      if (user) {
        rememberShareCtaDismissal(user.id)
        setShareCtaDismissed(true)
      }
      return true
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : 'The schedule link couldn’t be shared. Try again.')
      return false
    } finally {
      setSharing(false)
    }
  }

  function dismissShareCta() {
    if (user) rememberShareCtaDismissal(user.id)
    setShareCtaDismissed(true)
  }

  function openClearScheduleDialog() {
    setClearError(null)
    setClearScheduleOpen(true)
  }

  function closeClearScheduleDialog() {
    if (!clearingSchedule) setClearScheduleOpen(false)
  }

  function openImport(onboarding = false) {
    setImportOnboarding(onboarding)
    setImportOpen(true)
  }

  function closeImport() {
    if (user && importOnboarding && schedule.enrollments.length === 0 && !hasHandledOnboarding(user.id)) rememberOnboarding(user.id, 'dismissed')
    setImportOpen(false)
    setImportOnboarding(false)
  }

  if (showScheduleSkeleton) return <ScheduleSkeleton />

  const clarificationCallout = clarification
    ? <ClarificationCallout count={clarification.rowIds.length} onReview={() => setClarificationOpen(true)} onDismiss={finishClarification} />
    : null
  const clarificationPrompt = clarification && clarificationPromptOpen
    ? <ImportIssueChoiceDialog
      count={clarification.rowIds.length}
      onFix={() => { setClarificationPromptOpen(false); setClarificationOpen(true) }}
      onManual={finishClarification}
    />
    : null

  if (!user) {
    const sharedStudentCount = guestImportResult?.shared_student_count ?? 0
    const hasGuestPreview = guestPreviewEnrollments.length > 0
    return (
      <div className="page schedule-page is-guest">
        <PageHeader
          title="My schedule"
          description="Build your schedule and see who shares your classes."
          actions={hasGuestPreview ? <button className="button button-secondary" type="button" onClick={() => openImport(false)}><ImagePlus aria-hidden="true" />Import screenshot</button> : null}
        />
        {clarificationCallout}
        {!hasGuestPreview ? (
          <section className="schedule-intro" aria-labelledby="schedule-intro-title">
            <span className="schedule-intro-icon"><ImagePlus aria-hidden="true" /></span>
            <div className="schedule-intro-text">
              <h2 id="schedule-intro-title">Import your schedule</h2>
              <p>Upload a screenshot of your schedule and ScheduleShare will find your classes. To add classes one at a time, create an account first.</p>
            </div>
            <div className="schedule-intro-actions">
              <button className="button button-primary" type="button" onClick={() => openImport(false)}><ImagePlus aria-hidden="true" />Import screenshot</button>
              <button className="button button-secondary" type="button" onClick={() => openAccountPrompt('/schedule')}>Create account</button>
            </div>
          </section>
        ) : (
          <section className="notice schedule-callout is-account" aria-labelledby="schedule-account-title">
            <Users aria-hidden="true" />
            <div className="schedule-callout-text">
              <h2 id="schedule-account-title">See who shares classes with you</h2>
              <p><strong className="numeric">{sharedStudentCount}</strong> {sharedStudentCount === 1 ? 'student shares' : 'students share'} at least one class with you. Create an account to save this schedule and see who.</p>
            </div>
            <div className="schedule-callout-actions">
              <button className="button button-primary" type="button" onClick={() => {
                if (guestImportResult) saveGuestScheduleImportDraft(guestImportResult)
                openAccountPrompt('/schedule')
              }}>Create account</button>
            </div>
          </section>
        )}
        <section className="schedule-board" aria-label="Your classes">
          <div className="schedule-toolbar">
            <TermSelector value={selectedTerm} onChange={setPickedTerm} />
            <OpenScheduleSlotsNote enrollments={guestPreviewEnrollments} />
          </div>
          <ScheduleGrid
            enrollments={guestPreviewEnrollments}
            selectedTerm={selectedTerm}
            readOnly={hasGuestPreview}
            onAdd={() => openAccountPrompt('/schedule')}
            onRemove={() => undefined}
            onReplace={() => undefined}
            {...gridTodayProps}
          />
        </section>
        {importOpen ? <ScheduleImportDialog
          open
          isGuest
          currentEnrollments={[]}
          searchCourses={searchGuestCourseNames}
          loadClassOptions={findGuestClassesForCourse}
          onClose={closeImport}
          onImported={async () => undefined}
          onGuestPreview={(result) => {
            saveGuestScheduleImportDraft(result)
            setGuestImportResult(result)
          }}
          onNeedsClarification={startClarification}
        /> : null}
        {clarification && clarificationOpen ? <ScheduleImportDialog
          open
          isGuest
          initialResult={clarification.result}
          clarificationRowIds={clarification.rowIds}
          currentEnrollments={[]}
          searchCourses={searchGuestCourseNames}
          loadClassOptions={findGuestClassesForCourse}
          onClose={() => setClarificationOpen(false)}
          onImported={async () => undefined}
          onGuestPreview={(result) => {
            saveGuestScheduleImportDraft(result)
            setGuestImportResult(result)
          }}
          onClarificationChange={updateClarification}
          onClarificationResolved={finishClarification}
        /> : null}
        {clarificationPrompt}
      </div>
    )
  }

  const hasSchedule = schedule.enrollments.length > 0
  const enrollmentCount = schedule.enrollments.length
  const removeClass = (enrollment: ScheduleEnrollment) => void remove(enrollment)
  const replaceClass = (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => setActiveCell({ dayType, period, semester: selectedTerm, replacing: enrollment })
  const importDisabledReason = isDemo ? 'Connect Supabase to use AI screenshot importing.' : undefined
  const onImported = async ({ added, removed }: { added: number; removed: number }) => {
    await schedule.reload()
    clearGuestScheduleImportDraft()
    rememberOnboarding(user.id, 'completed')
    showToast(importSavedMessage(added, removed))
  }

  return (
    <div className="page schedule-page">
      <PageHeader
        title="My schedule"
        description="Your A and B day classes, period by period."
        actions={hasSchedule ? (
          <>
            <button className="button button-secondary" type="button" disabled={isDemo} title={importDisabledReason} onClick={() => openImport(false)}><ImagePlus aria-hidden="true" />Import screenshot</button>
            <button className="button button-secondary" type="button" disabled={sharing} onClick={() => void shareSchedule()}><Share2 aria-hidden="true" />{sharing ? 'Sharing…' : 'Share schedule'}</button>
          </>
        ) : null}
      />

      {clarificationCallout}
      {pageError ? <ErrorNotice onDismiss={() => setPageError(null)}>{pageError}</ErrorNotice> : null}
      {schedule.error ? (
        <ErrorNotice action={<button className="button button-secondary button-sm" type="button" onClick={() => void schedule.reload()}><RefreshCw aria-hidden="true" />Try again</button>}>
          <strong>Your schedule didn’t load.</strong> {schedule.error}
        </ErrorNotice>
      ) : null}

      {!hasSchedule ? (
        <section className="schedule-intro" aria-labelledby="schedule-intro-title">
          <span className="schedule-intro-icon"><ImagePlus aria-hidden="true" /></span>
          <div className="schedule-intro-text">
            <h2 id="schedule-intro-title" ref={introHeadingRef} tabIndex={-1}>Add your schedule in about a minute</h2>
            <p>Upload a screenshot of your schedule from the school portal. ScheduleShare reads your classes, and you can fix anything it gets wrong.</p>
          </div>
          <ol className="schedule-intro-steps">
            <li><span className="period-numeral" aria-hidden="true">1</span>Take a screenshot</li>
            <li><span className="period-numeral" aria-hidden="true">2</span>Check your classes</li>
            <li><span className="period-numeral" aria-hidden="true">3</span>Find your classmates</li>
          </ol>
          <div className="schedule-intro-actions">
            <button className="button button-primary" type="button" disabled={isDemo} title={importDisabledReason} onClick={() => openImport(false)}><ImagePlus aria-hidden="true" />Import screenshot</button>
            <button className="button button-secondary" type="button" onClick={() => setActiveCell({ dayType: 'A', period: 1, semester: selectedTerm })}>Enter classes manually</button>
          </div>
        </section>
      ) : null}

      {hasSchedule && !profile?.students_visited_at ? (
        <section className="notice schedule-callout" aria-labelledby="schedule-discovery-title">
          <Users aria-hidden="true" />
          <div className="schedule-callout-text">
            <h2 id="schedule-discovery-title">See who you share classes with</h2>
            <p>Every period lists the classmates who are in it with you.</p>
          </div>
          <div className="schedule-callout-actions">
            <Link className="button button-primary button-sm" to="/students">Find classmates</Link>
          </div>
        </section>
      ) : null}
      {hasSchedule && profile?.students_visited_at && !shareCtaDismissed ? (
        <section className="notice schedule-callout" aria-labelledby="schedule-share-title">
          <Share2 aria-hidden="true" />
          <div className="schedule-callout-text">
            <h2 id="schedule-share-title">Share your schedule with friends</h2>
            <p>Send a link that shows your full schedule.</p>
          </div>
          <div className="schedule-callout-actions">
            <button className="button button-primary button-sm" type="button" disabled={sharing} onClick={() => void shareSchedule()}>{sharing ? 'Sharing…' : 'Share link'}</button>
          </div>
          <button className="icon-button schedule-callout-dismiss" type="button" aria-label="Dismiss sharing reminder" onClick={dismissShareCta}><X aria-hidden="true" /></button>
        </section>
      ) : null}

      <section className="schedule-board" aria-label="Your classes" aria-busy={schedule.loading || undefined} ref={scheduleBoardRef} tabIndex={-1}>
        <div className="schedule-toolbar">
          <TermSelector value={selectedTerm} onChange={setPickedTerm} />
          <OpenScheduleSlotsNote enrollments={schedule.enrollments} />
        </div>
        <ConflictNotice
          enrollments={schedule.enrollments}
          term={selectedTerm}
          onReplace={replaceClass}
          onRemove={(enrollment) => {
            // The button goes away with the class, so keep focus on the schedule.
            scheduleBoardRef.current?.focus({ preventScroll: true })
            removeClass(enrollment)
          }}
        />
        <ScheduleGrid
          enrollments={schedule.enrollments}
          selectedTerm={selectedTerm}
          onAdd={(dayType, period) => setActiveCell({ dayType, period, semester: selectedTerm })}
          onRemove={removeClass}
          onReplace={replaceClass}
          {...gridTodayProps}
        />
        {hasSchedule ? (
          <div className="schedule-board-footer">
            <button className="button button-ghost schedule-clear-button" type="button" disabled={clearingSchedule} onClick={openClearScheduleDialog}><Trash2 aria-hidden="true" />Clear schedule</button>
          </div>
        ) : null}
      </section>

      {activeCell ? <AddClassDialog
        open
        dayType={activeCell.dayType}
        period={activeCell.period}
        semester={activeCell.semester}
        replacing={activeCell.replacing}
        onClose={() => setActiveCell(null)}
        onChanged={schedule.reload}
        onDemoAdd={(classDefinition: ClassDefinition, term, replacingEnrollmentId) => schedule.addDemoEnrollment(classDefinition, term, replacingEnrollmentId)}
      /> : null}
      {importOpen ? <ScheduleImportDialog
        open
        onboarding={importOnboarding}
        isAdmin={isAdmin}
        currentEnrollments={schedule.enrollments}
        onClose={closeImport}
        onManualEntry={() => setActiveCell({ dayType: 'A', period: 1, semester: selectedTerm })}
        onImported={onImported}
        onNeedsClarification={startClarification}
      /> : null}
      {clarification && clarificationOpen ? <ScheduleImportDialog
        open
        isAdmin={isAdmin}
        initialResult={clarification.result}
        clarificationRowIds={clarification.rowIds}
        currentEnrollments={schedule.enrollments}
        onClose={() => setClarificationOpen(false)}
        onImported={onImported}
        onClarificationChange={updateClarification}
        onClarificationResolved={finishClarification}
      /> : null}
      {clarificationPrompt}
      {clearScheduleOpen ? (
        <Dialog
          title="Clear your schedule?"
          description={enrollmentCount === 1 ? 'This removes your 1 class from your schedule.' : `This removes all ${enrollmentCount} classes from your schedule.`}
          onClose={closeClearScheduleDialog}
          dismissible={!clearingSchedule}
          closeLabel="Close clear schedule confirmation"
          size="small"
          footer={(
            <>
              <button className="button button-secondary" type="button" disabled={clearingSchedule} onClick={closeClearScheduleDialog}>Cancel</button>
              <button className="button button-danger" type="button" disabled={clearingSchedule} onClick={() => void clearAllClasses()}>{clearingSchedule ? 'Clearing…' : 'Remove all classes'}</button>
            </>
          )}
        >
          <p className="schedule-dialog-note">The classes stay in the catalog for other students, and you can add yours again any time.</p>
          {clearError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{clearError}</p> : null}
        </Dialog>
      ) : null}
    </div>
  )
}
