import { CheckCircle2, ImagePlus, Plus, Share2, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGuestAccountPrompt } from '../components/auth/GuestAccountPrompt'
import { AddClassDialog } from '../components/schedule/AddClassDialog'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { ScheduleImportDialog } from '../components/schedule/ScheduleImportDialog'
import { TermSelector } from '../components/schedule/TermSelector'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import type { AcademicTerm, ClassDefinition, DayType, ScheduleEnrollment } from '../lib/domain'
import { createScheduleShareUrl, scheduleShareTitle } from '../lib/scheduleShare'
import { removeEnrollment, updateEnrollmentTerm } from '../lib/supabase/data'

interface ActiveCell { dayType: DayType; period: number; replacing?: ScheduleEnrollment | null }

function onboardingKey(userId: string): string {
  return `scheduleshare:schedule-onboarding:${userId}`
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
  const { user, isAdmin, isDemo } = useAuth()
  const { openAccountPrompt } = useGuestAccountPrompt()
  const schedule = useSchedule()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm>('full_year')
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importOnboarding, setImportOnboarding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showSavedCheck, setShowSavedCheck] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareCtaDismissed, setShareCtaDismissed] = useState(() => user ? hasDismissedShareCta(user.id) : true)
  const onboardingChecked = useRef(false)

  useEffect(() => {
    setShareCtaDismissed(user ? hasDismissedShareCta(user.id) : true)
  }, [user])

  useEffect(() => {
    if (!user || schedule.loading) return
    if (schedule.enrollments.length > 0) {
      onboardingChecked.current = true
      rememberOnboarding(user.id, 'completed')
      return
    }
    if (searchParams.get('import') === '1') {
      onboardingChecked.current = true
      setImportOnboarding(false)
      setImportOpen(true)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('import')
      setSearchParams(nextParams, { replace: true })
      return
    }
    if (onboardingChecked.current) return
    onboardingChecked.current = true
    if (!hasHandledOnboarding(user.id)) {
      setImportOnboarding(true)
      setImportOpen(true)
    }
  }, [schedule.enrollments.length, schedule.loading, searchParams, setSearchParams, user])

  async function remove(enrollment: ScheduleEnrollment) {
    if (isDemo) schedule.removeDemoEnrollment(enrollment.id)
    else {
      await removeEnrollment(enrollment.id)
      await schedule.reload()
    }
    setMessage(`${enrollment.class.course_name} was removed from your schedule.`)
    setShowSavedCheck(false)
  }

  async function changeTerm(enrollment: ScheduleEnrollment, term: AcademicTerm) {
    if (isDemo) schedule.updateDemoTerm(enrollment.id, term)
    else {
      await updateEnrollmentTerm(enrollment.id, term)
      await schedule.reload()
    }
    setMessage('Academic term updated.')
    setShowSavedCheck(false)
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
    return (
      <div className="schedule-page guest-schedule-page">
        <header className="page-heading schedule-heading">
          <div><h1>Schedule</h1><p>Build your schedule and find the people in your classes.</p></div>
          <div className="schedule-heading-actions">
            <button className="button button-secondary" type="button" onClick={() => openAccountPrompt('/schedule')}><ImagePlus size={18} aria-hidden="true" /> Import schedule</button>
            <button className="button button-secondary" type="button" onClick={() => openAccountPrompt('/schedule')}><Plus size={18} aria-hidden="true" /> Add new class</button>
          </div>
        </header>
        <TermSelector value={selectedTerm} onChange={setSelectedTerm} />
        <div className="schedule-layout">
          <ScheduleGrid enrollments={[]} selectedTerm={selectedTerm} onAdd={() => openAccountPrompt('/schedule')} onRemove={() => undefined} onReplace={() => undefined} onTermChange={() => undefined} />
        </div>
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
        </div>
      </header>
      {message ? <div className={showSavedCheck ? 'toast-message schedule-save-success' : 'toast-message'} role="status">{showSavedCheck ? <CheckCircle2 className="success-checkmark" aria-hidden="true" /> : null}<span>{message}</span><button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div> : null}
      {schedule.error ? <div className="notice-box error" role="alert">{schedule.error}</div> : null}
      {!hasSchedule ? <section className="schedule-import-empty-card">
        <ImagePlus size={34} aria-hidden="true" />
        <div><h2>Add your schedule in about a minute</h2><p>Upload screenshots, and ScheduleShare will identify your classes.</p><div className="import-onboarding-flow"><span>Screenshot</span><strong>→</strong><span>Review classes</span><strong>→</strong><span>Find classmates</span></div></div>
        <div><button className="button button-primary" type="button" disabled={isDemo} onClick={() => openImport(false)}>Choose Screenshot</button><button className="button button-secondary" type="button" onClick={() => setActiveCell({ dayType: 'A', period: 1 })}>Enter Schedule Manually</button></div>
      </section> : null}
      {hasSchedule && !shareCtaDismissed ? <section className="schedule-share-cta">
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
          onTermChange={(enrollment, term) => void changeTerm(enrollment, term)}
        />
      </div>
      {hasSchedule ? <section className="schedule-discovery-callout"><Users aria-hidden="true" /><div><h2>See Who You Share Classes With</h2></div><Link className="button button-primary" to="/classmates">Find Classmates</Link></section> : null}
      {activeCell ? <AddClassDialog
        open
        dayType={activeCell.dayType}
        period={activeCell.period}
        replacing={activeCell.replacing}
        onClose={() => setActiveCell(null)}
        onChanged={schedule.reload}
        onDemoAdd={(classDefinition: ClassDefinition, term) => schedule.addDemoEnrollment(classDefinition, term)}
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
          rememberOnboarding(user.id, 'completed')
          setShowSavedCheck(true)
          setMessage(`Schedule saved: ${added} ${added === 1 ? 'class' : 'classes'} added and ${removed} prior ${removed === 1 ? 'class' : 'classes'} removed.`)
        }}
      /> : null}
    </div>
  )
}
