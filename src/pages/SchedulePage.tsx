import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { AddClassDialog } from '../components/schedule/AddClassDialog'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { TermSelector } from '../components/schedule/TermSelector'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { useAuth } from '../features/auth/AuthProvider'
import { useSchedule } from '../hooks/useSchedule'
import type { AcademicTerm, ClassDefinition, DayType, ScheduleEnrollment } from '../lib/domain'
import { removeEnrollment, updateEnrollmentTerm } from '../lib/supabase/data'

interface ActiveCell { dayType: DayType; period: number; replacing?: ScheduleEnrollment | null }

export function SchedulePage() {
  const { isDemo } = useAuth()
  const schedule = useSchedule()
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm>('full_year')
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function remove(enrollment: ScheduleEnrollment) {
    if (!window.confirm(`Remove ${enrollment.class.course_name} from your schedule? The shared class will not be deleted.`)) return
    if (isDemo) schedule.removeDemoEnrollment(enrollment.id)
    else {
      await removeEnrollment(enrollment.id)
      await schedule.reload()
    }
    setMessage(`${enrollment.class.course_name} was removed from your schedule.`)
  }

  async function changeTerm(enrollment: ScheduleEnrollment, term: AcademicTerm) {
    if (isDemo) schedule.updateDemoTerm(enrollment.id, term)
    else {
      await updateEnrollmentTerm(enrollment.id, term)
      await schedule.reload()
    }
    setMessage('Academic term updated.')
  }

  async function shareSchedule() {
    const url = `${window.location.origin}${window.location.pathname}#/students/${encodeURIComponent(enrollmentOwner())}`
    await navigator.clipboard.writeText(url)
    setMessage('Schedule link copied. Privacy rules still apply to anyone who opens it.')
  }

  function enrollmentOwner() {
    return schedule.enrollments[0]?.student_id ?? ''
  }

  if (schedule.loading) return <LoadingScreen label="Loading your schedule…" />
  return (
    <div className="schedule-page">
      <header className="page-heading schedule-heading">
        <div><h1>My Schedule</h1><p>Build your A/B-day schedule and find the people in your classes.</p></div>
        <button className="button button-secondary" type="button" onClick={() => void shareSchedule()}><Share2 size={18} aria-hidden="true" /> Share schedule</button>
      </header>
      {message ? <div className="toast-message" role="status">{message}<button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div> : null}
      {schedule.error ? <div className="notice-box error" role="alert">{schedule.error}</div> : null}
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
      {activeCell ? <AddClassDialog
        open
        dayType={activeCell.dayType}
        period={activeCell.period}
        replacing={activeCell.replacing}
        onClose={() => setActiveCell(null)}
        onChanged={schedule.reload}
        onDemoAdd={(classDefinition: ClassDefinition, term) => schedule.addDemoEnrollment(classDefinition, term)}
      /> : null}
    </div>
  )
}
