import { AlertTriangle, Check, Clock3, Lightbulb, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { HistoryRecord, ScheduleEnrollment } from '../../lib/domain'
import { findScheduleConflicts, scheduleCompletion } from '../../lib/schedule'

function historyText(record: HistoryRecord) {
  const values = record.new_value ?? record.previous_value ?? {}
  const className = typeof values.class_name === 'string' ? values.class_name : 'a class'
  if (record.action === 'class_added') return `Added ${className}`
  if (record.action === 'class_removed') return `Removed ${className}`
  if (record.action === 'class_replaced') return `Replaced ${className}`
  if (record.action === 'term_changed') return `Changed term for ${className}`
  return 'Schedule updated'
}

export function ScheduleUtilityRail({ enrollments, history }: { enrollments: ScheduleEnrollment[]; history: HistoryRecord[] }) {
  const completion = scheduleCompletion(enrollments)
  const conflicts = findScheduleConflicts(enrollments).length
  return (
    <aside className="schedule-utility-rail">
      <section className="utility-panel clipped-panel">
        <h2>Schedule progress</h2>
        <div className="progress-item"><Check aria-hidden="true" /><div><span><strong>Classes added</strong><em>{enrollments.length}</em></span><div className="progress-track"><i style={{ width: `${Math.min(100, enrollments.length / 8 * 100)}%` }} /></div></div></div>
        <div className="progress-item"><Clock3 aria-hidden="true" /><div><span><strong>Periods filled</strong><em>{completion}%</em></span><div className="progress-track"><i style={{ width: `${completion}%` }} /></div></div></div>
        <div className={conflicts ? 'progress-item conflict' : 'progress-item'}><AlertTriangle aria-hidden="true" /><div><span><strong>Conflicts</strong><em>{conflicts}</em></span><div className="progress-track"><i style={{ width: conflicts ? '20%' : '0%' }} /></div></div></div>
      </section>
      <section className="utility-panel clipped-panel recent-changes">
        <h2>Recent changes</h2>
        {history.slice(0, 5).map((record) => <div className="history-row" key={record.id}>{record.action === 'class_removed' ? <Trash2 aria-hidden="true" /> : record.action === 'term_changed' ? <RefreshCw aria-hidden="true" /> : <Plus aria-hidden="true" />}<div><strong>{historyText(record)}</strong><small>{new Date(record.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small></div></div>)}
        {history.length === 0 ? <p className="muted">Your changes will appear here.</p> : null}
      </section>
      <section className="utility-panel tip-panel"><Lightbulb aria-hidden="true" /><div><h2>Tip</h2><p>Double classes occupy two periods. Confirm every meeting slot before adding one.</p></div></section>
    </aside>
  )
}
