import { CalendarDays, Clock3, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SchoolDayContext } from '../../lib/domain'
import { easternDateKey, easternLocalTime, formatEasternDate, formatEasternTime } from '../../lib/bellSchedule'

interface BellScheduleDialogProps {
  day: SchoolDayContext
  now: Date
  onClose: () => void
}

export function BellScheduleDialog({ day, now, onClose }: BellScheduleDialogProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const schedule = day.schedule

  useEffect(() => {
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!schedule) return null

  const today = easternDateKey(now)
  const orderedBlocks = [...schedule.blocks].sort((left, right) => left.position - right.position)

  return createPortal(<div className="dialog-backdrop bell-schedule-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="bell-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="bell-schedule-dialog-header">
        <div className="bell-schedule-dialog-icon"><CalendarDays aria-hidden="true" /></div>
        <div className="bell-schedule-dialog-heading">
          <span className="eyebrow">{day.campus} · {day.day_type ? `${day.day_type} day` : 'School day'}</span>
          <h2 id={titleId}>{schedule.display_name}</h2>
          <p>{formatEasternDate(easternLocalTime(day.date, '12:00'))}</p>
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close bell schedule" onClick={onClose}><X aria-hidden="true" /></button>
      </header>

      {schedule.warning_time ? <p className="bell-warning-time"><Clock3 aria-hidden="true" /> Warning bell at {formatEasternTime(easternLocalTime(day.date, schedule.warning_time))}</p> : null}

      <div className="bell-schedule-list" aria-label="Bell schedule blocks">
        {orderedBlocks.map((block) => {
          const startsAt = easternLocalTime(day.date, block.start_time)
          const endsAt = easternLocalTime(day.date, block.end_time)
          const isCurrent = day.date === today && now.getTime() >= startsAt.getTime() && now.getTime() < endsAt.getTime()
          const isPast = day.date === today && now.getTime() >= endsAt.getTime()
          return <div className={`bell-schedule-row ${isCurrent ? 'is-current' : ''} ${isPast ? 'is-past' : ''}`} key={`${block.position}-${block.label}`}>
            <span className="bell-schedule-row-order">{block.period_number ?? '—'}</span>
            <span className="bell-schedule-row-label"><strong>{block.label}</strong></span>
            <span className="bell-schedule-row-time">{formatEasternTime(startsAt)} <span aria-hidden="true">-</span><span className="sr-only">to</span> {formatEasternTime(endsAt)}</span>
            {isCurrent ? <span className="bell-current-badge">Now</span> : null}
          </div>
        })}
      </div>
    </section>
  </div>, document.body)
}
