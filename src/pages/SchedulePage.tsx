import { AlertTriangle, CheckCircle2, ImagePlus, Plus, Share2, Trash2, Users, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { AddClassDialog } from '../components/schedule/AddClassDialog'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { ScheduleImportDialog, type ScheduleImportClarification } from '../components/schedule/ScheduleImportDialog'
import { TermSelector } from '../components/schedule/TermSelector'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { useAuth } from '../features/auth/AuthProvider'
import { useDialogAccessibility } from '../hooks/useDialogAccessibility'
import { useSchedule } from '../hooks/useSchedule'
import type { ClassDefinition, DayType, ScheduleEnrollment, SemesterTerm } from '../lib/domain'
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
import { createScheduleShareUrl, scheduleShareTitle } from '../lib/scheduleShare'
import { clearSchedule, removeEnrollment, searchGuestCourseNames } from '../lib/supabase/data'

interface ActiveCell { dayType: DayType; period: number; replacing?: ScheduleEnrollment | null }

function ClarificationCallout({ count, onReview, onDismiss }: { count: number; onReview: () => void; onDismiss: () => void }) {
  return <section className="schedule-clarification-callout" role="status">
    <AlertTriangle aria-hidden="true" />
    <div><h2>{count} {count === 1 ? 'class needs' : 'classes need'} clarification</h2><p>Valid classes were imported. Review the specific issue for each remaining class.</p></div>
    <div className="schedule-clarification-actions"><button className="button button-primary" type="button" onClick={onReview}>Review classes</button><button className="icon-button" type="button" aria-label="Dismiss clarification reminder" onClick={onDismiss}><X aria-hidden="true" /></button></div>
  </section>
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

function isMobileShareDevice(): boolean {
  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  if (typeof navigatorWithUserAgentData.userAgentData?.mobile === 'boolean') return navigatorWithUserAgentData.userAgentData.mobile
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function SchedulePage() {
  const { user, profile, isAdmin, isDemo } = useAuth()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const schedule = useSchedule()
  const reloadSchedule = schedule.reload
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedTerm, setSelectedTerm] = useState<SemesterTerm>('semester_1')
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importOnboarding, setImportOnboarding] = useState(false)
  const [guestImportResult, setGuestImportResult] = useState<ScheduleImportResult | null>(null)
  const clarificationOwnerId = user?.id ?? 'guest'
  const [clarification, setClarification] = useState<ScheduleImportClarification | null>(() => loadClarification(clarificationOwnerId))
  const [clarificationOpen, setClarificationOpen] = useState(false)
  const [clearScheduleOpen, setClearScheduleOpen] = useState(false)
  const [clearingSchedule, setClearingSchedule] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showSavedCheck, setShowSavedCheck] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareCtaDismissed, setShareCtaDismissed] = useState(() => user ? hasDismissedShareCta(user.id) : true)
  const clearScheduleDialogRef = useDialogAccessibility(clearScheduleOpen, closeClearScheduleDialog, !clearingSchedule)
  const onboardingCheckedFor = useRef<string | null>(null)
  const guestTransferStartedFor = useRef<string | null>(null)
  const guestPreviewEnrollments = useMemo(
    () => guestImportResult ? scheduleImportPreviewEnrollments(guestImportResult) : [],
    [guestImportResult],
  )

  useEffect(() => {
    setClarification(loadClarification(clarificationOwnerId))
    setClarificationOpen(false)
  }, [clarificationOwnerId])

  const updateClarification = useCallback((next: ScheduleImportClarification) => {
    saveClarification(clarificationOwnerId, next)
    setClarification(next)
  }, [clarificationOwnerId])

  const startClarification = useCallback((next: ScheduleImportClarification) => {
    updateClarification(next)
    setClarificationOpen(true)
  }, [updateClarification])

  const finishClarification = useCallback(() => {
    clearClarification(clarificationOwnerId)
    setClarification(null)
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
      setShowSavedCheck(true)
      setMessage(`Imported schedule saved automatically: ${saved.added} ${saved.added === 1 ? 'class' : 'classes'} added.`)
      removeLegacyResumeMarker()
    })().catch((caught: unknown) => {
      setMessage(caught instanceof Error ? `Your imported schedule is still available, but could not be saved automatically: ${caught.message}` : 'Your imported schedule is still available, but could not be saved automatically.')
      removeLegacyResumeMarker()
    })
  }, [profile?.grade, profile?.onboarding_completed, reloadSchedule, schedule.enrollments.length, schedule.loading, searchParams, setSearchParams, user])

  async function remove(enrollment: ScheduleEnrollment) {
    try {
      if (isDemo) schedule.removeDemoEnrollment(enrollment.id)
      else {
        await removeEnrollment(enrollment.id)
        await schedule.reload()
      }
      setMessage(`${enrollment.class.course_name} was removed from your schedule.`)
      setShowSavedCheck(false)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The class could not be removed from your schedule.')
      setShowSavedCheck(false)
    }
  }

  async function clearAllClasses() {
    if (clearingSchedule) return
    setClearingSchedule(true)
    try {
      const removed = isDemo
        ? schedule.enrollments.reduce((count, enrollment) => {
          schedule.removeDemoEnrollment(enrollment.id)
          return count + 1
        }, 0)
        : await clearSchedule()
      if (!isDemo) await schedule.reload()
      setClearScheduleOpen(false)
      setShowSavedCheck(false)
      setMessage(`Schedule cleared: ${removed} ${removed === 1 ? 'class was' : 'classes were'} removed.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Your schedule could not be cleared.')
    } finally {
      setClearingSchedule(false)
    }
  }

  async function shareSchedule(): Promise<boolean> {
    setSharing(true)
    try {
      const url = await createScheduleShareUrl()
      if (isMobileShareDevice() && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: scheduleShareTitle,
            url,
          })
          setMessage('Schedule shared.')
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === 'AbortError') return false
          if (caught instanceof Error && caught.name === 'AbortError') return false
          throw caught
        }
      } else {
        await navigator.clipboard.writeText(url)
        setMessage('Schedule link copied.')
      }
      setShowSavedCheck(false)
      if (user) {
        rememberShareCtaDismissal(user.id)
        setShareCtaDismissed(true)
      }
      return true
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The schedule link could not be shared.')
      setShowSavedCheck(false)
      return false
    } finally {
      setSharing(false)
    }
  }

  function dismissShareCta() {
    if (user) rememberShareCtaDismissal(user.id)
    setShareCtaDismissed(true)
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

  if (schedule.loading) return <LoadingScreen label="Loading your schedule…" />

  if (!user) {
    const sharedStudentCount = guestImportResult?.shared_student_count ?? 0
    const hasGuestPreview = guestPreviewEnrollments.length > 0
    return (
      <div className="schedule-page guest-schedule-page">
        <header className="page-heading schedule-heading">
          <div><h1>My Schedule</h1><p>Build your schedule and find the people in your classes.</p></div>
          <div className="schedule-heading-actions">
            <button className="button button-import" type="button" onClick={() => openImport(false)}><ImagePlus size={18} aria-hidden="true" /> Import schedule</button>
            <button className="button button-secondary" type="button" onClick={() => openAccountPrompt('/schedule')}><Plus size={18} aria-hidden="true" /> Add new class</button>
          </div>
        </header>
        {clarification ? <ClarificationCallout count={clarification.rowIds.length} onReview={() => setClarificationOpen(true)} onDismiss={finishClarification} /> : null}
        {!hasGuestPreview ? <section className="schedule-import-empty-card guest-import-try-card">
          <ImagePlus size={34} aria-hidden="true" />
          <div><h2>Import your schedule</h2><p>Upload screenshots, and ScheduleShare will identify your classes.</p></div>
          <button className="button button-primary" type="button" onClick={() => openImport(false)}>Choose Screenshot</button>
        </section> : <section className="schedule-share-cta guest-schedule-account-cta">
          <Users size={34} aria-hidden="true" />
          <div><h2>See who shares classes with you</h2><p><strong>{sharedStudentCount}</strong> {sharedStudentCount === 1 ? 'student shares' : 'students share'} at least one class with you. Create an account to save this schedule and see who.</p></div>
          <div className="schedule-share-cta-actions"><button className="button button-primary" type="button" onClick={() => {
            if (guestImportResult) saveGuestScheduleImportDraft(guestImportResult)
            openAccountPrompt('/schedule')
          }}>Create account</button></div>
        </section>}
        <TermSelector value={selectedTerm} onChange={setSelectedTerm} />
        <div className="schedule-layout">
          <ScheduleGrid enrollments={guestPreviewEnrollments} selectedTerm={selectedTerm} readOnly={hasGuestPreview} onAdd={() => openAccountPrompt('/schedule')} onRemove={() => undefined} onReplace={() => undefined} />
        </div>
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
      </div>
    )
  }

  const hasSchedule = schedule.enrollments.length > 0
  return (
    <div className="schedule-page">
      <header className="page-heading schedule-heading">
        <div><h1>My Schedule</h1><p>Build your schedule and find the people in your classes.</p></div>
        <div className="schedule-heading-actions">
          <button className="button button-import" type="button" disabled={isDemo} title={isDemo ? 'Connect Supabase to use AI screenshot importing.' : undefined} onClick={() => openImport(false)}><ImagePlus size={18} aria-hidden="true" /> Import schedule</button>
          <button className="button button-secondary" type="button" disabled={!hasSchedule || sharing} onClick={() => void shareSchedule()}><Share2 size={18} aria-hidden="true" /> {sharing ? 'Sharing…' : 'Share schedule'}</button>
          <button className="button button-secondary danger-text" type="button" disabled={!hasSchedule || clearingSchedule} onClick={() => setClearScheduleOpen(true)}><Trash2 size={18} aria-hidden="true" /> Clear schedule</button>
        </div>
      </header>
      {clarification ? <ClarificationCallout count={clarification.rowIds.length} onReview={() => setClarificationOpen(true)} onDismiss={finishClarification} /> : null}
      {message ? <div className={showSavedCheck ? 'toast-message schedule-save-success' : 'toast-message'} role="status">{showSavedCheck ? <CheckCircle2 className="success-checkmark" aria-hidden="true" /> : null}<span>{message}</span><button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div> : null}
      {schedule.error ? <div className="notice-box error" role="alert">{schedule.error}</div> : null}
      {!hasSchedule ? <section className="schedule-import-empty-card">
        <ImagePlus size={34} aria-hidden="true" />
        <div><h2>Add your schedule in about a minute</h2><p>Upload screenshots, and ScheduleShare will identify your classes.</p><div className="import-onboarding-flow"><span>Screenshot</span><strong>→</strong><span>Review classes</span><strong>→</strong><span>Find classmates</span></div></div>
        <div><button className="button button-primary" type="button" disabled={isDemo} onClick={() => openImport(false)}>Choose Screenshot</button><button className="button button-secondary" type="button" onClick={() => setActiveCell({ dayType: 'A', period: 1 })}>Enter Schedule Manually</button></div>
      </section> : null}
      {hasSchedule && !profile?.students_visited_at ? <section className="schedule-discovery-callout">
        <Users aria-hidden="true" />
        <div><h2>See Who You Share Classes With</h2></div>
        <Link className="button button-primary" to="/students">Find Classmates</Link>
      </section> : null}
      {hasSchedule && profile?.students_visited_at && !shareCtaDismissed ? <section className="schedule-share-cta">
        <Share2 size={34} aria-hidden="true" />
        <div><h2>Share your Schedule with friends</h2><p>Send a link that shows your full schedule</p></div>
        <div className="schedule-share-cta-actions"><button className="button button-primary" type="button" disabled={sharing} onClick={() => void shareSchedule()}>{sharing ? 'Sharing…' : 'Share'}</button><button className="icon-button" type="button" aria-label="Dismiss sharing reminder" onClick={dismissShareCta}><X size={18} aria-hidden="true" /></button></div>
      </section> : null}
      <TermSelector value={selectedTerm} onChange={setSelectedTerm} />
      <div className="schedule-layout">
        <ScheduleGrid
          enrollments={schedule.enrollments}
          selectedTerm={selectedTerm}
          onAdd={(dayType, period) => setActiveCell({ dayType, period })}
          onRemove={(enrollment) => void remove(enrollment)}
          onReplace={(enrollment, dayType, period) => setActiveCell({ dayType, period, replacing: enrollment })}
        />
      </div>
      {activeCell ? <AddClassDialog
        open
        dayType={activeCell.dayType}
        period={activeCell.period}
        semester={selectedTerm}
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
        onManualEntry={() => setActiveCell({ dayType: 'A', period: 1 })}
        onImported={async ({ added, removed }) => {
          await schedule.reload()
          clearGuestScheduleImportDraft()
          rememberOnboarding(user.id, 'completed')
          setShowSavedCheck(true)
          setMessage(`Schedule saved: ${added} ${added === 1 ? 'class' : 'classes'} added and ${removed} prior ${removed === 1 ? 'class' : 'classes'} removed.`)
        }}
        onNeedsClarification={startClarification}
      /> : null}
      {clarification && clarificationOpen ? <ScheduleImportDialog
        open
        isAdmin={isAdmin}
        initialResult={clarification.result}
        clarificationRowIds={clarification.rowIds}
        currentEnrollments={schedule.enrollments}
        onClose={() => setClarificationOpen(false)}
        onImported={async ({ added, removed }) => {
          await schedule.reload()
          clearGuestScheduleImportDraft()
          rememberOnboarding(user.id, 'completed')
          setShowSavedCheck(true)
          setMessage(`Schedule saved: ${added} ${added === 1 ? 'class' : 'classes'} added and ${removed} prior ${removed === 1 ? 'class' : 'classes'} removed.`)
        }}
        onClarificationChange={updateClarification}
        onClarificationResolved={finishClarification}
      /> : null}
      {clearScheduleOpen ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClearScheduleDialog() }}>
        <section className="class-dialog clear-schedule-dialog" ref={clearScheduleDialogRef} role="dialog" aria-modal="true" aria-labelledby="clear-schedule-dialog-title" aria-describedby="clear-schedule-dialog-description" tabIndex={-1}>
          <header><div><h2 id="clear-schedule-dialog-title">Clear your schedule?</h2><p id="clear-schedule-dialog-description">Are you sure? This will remove all {schedule.enrollments.length} {schedule.enrollments.length === 1 ? 'class' : 'classes'} from your schedule. The shared classes themselves will not be deleted.</p></div><button className="icon-button" type="button" aria-label="Close clear schedule confirmation" disabled={clearingSchedule} onClick={closeClearScheduleDialog}><X aria-hidden="true" /></button></header>
          <div className="form-actions"><button className="button button-secondary" type="button" disabled={clearingSchedule} onClick={closeClearScheduleDialog}>Cancel</button><button className="button button-danger" type="button" disabled={clearingSchedule} onClick={() => void clearAllClasses()}>{clearingSchedule ? 'Clearing…' : 'Yes, clear schedule'}</button></div>
        </section>
      </div> : null}
    </div>
  )
}
