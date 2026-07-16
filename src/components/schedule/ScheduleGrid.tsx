import { AlertTriangle, MoreVertical, Plus } from 'lucide-react'
import { termLabels, type AcademicTerm, type DayType, type ScheduleEnrollment } from '../../lib/domain'
import { enrollmentAtSlot, findScheduleConflicts, hasMultiplePeriodsOnAnyDay, isMeetingSlotContinuation, meetingSlotsForDay, PERIOD_NUMBERS } from '../../lib/schedule'

interface ScheduleGridProps {
  enrollments: ScheduleEnrollment[]
  selectedTerm: AcademicTerm
  onAdd: (dayType: DayType, period: number) => void
  onRemove: (enrollment: ScheduleEnrollment) => void
  onReplace: (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => void
  onTermChange: (enrollment: ScheduleEnrollment, term: AcademicTerm) => void
  readOnly?: boolean
}

export function ScheduleGrid({ enrollments, selectedTerm, onAdd, onRemove, onReplace, onTermChange, readOnly = false }: ScheduleGridProps) {
  const conflicts = findScheduleConflicts(enrollments)
  const conflictedIds = new Set(conflicts.flatMap((pair) => pair.map((enrollment) => enrollment.id)))
  return (
    <div className="schedule-grid-wrap">
      <div className="schedule-grid" role="grid" aria-label={`${termLabels[selectedTerm]} A/B-day schedule`}>
        <div className="schedule-corner" role="columnheader" />
        {(['A', 'B'] as DayType[]).map((day) => <div className={`day-header day-${day.toLowerCase()}`} role="columnheader" key={day}>{day} Day</div>)}
        {PERIOD_NUMBERS.map((period) => (
          <div className="schedule-row" role="row" data-period={period} key={period}>
            <div className="period-label" role="rowheader" data-period={period}><span>Period</span> {period}</div>
            {(['A', 'B'] as DayType[]).map((dayType) => {
              const enrollment = enrollmentAtSlot(enrollments, dayType, period, selectedTerm)
              if (!enrollment) {
                return readOnly ? (
                  <div className="schedule-cell empty-cell readonly-cell" role="gridcell" data-day={dayType} data-period={period} key={dayType}>
                    <span>Open</span>
                  </div>
                ) : (
                  <button className="schedule-cell empty-cell" role="gridcell" data-day={dayType} data-period={period} type="button" key={dayType} onClick={() => onAdd(dayType, period)}>
                    <Plus size={19} aria-hidden="true" /> Add class
                  </button>
                )
              }
              const daySlots = meetingSlotsForDay(enrollment.class.meeting_slots, dayType)
              const hasMultiplePeriods = daySlots.length > 1
              const isDoublePeriod = enrollment.class.is_double_period || hasMultiplePeriodsOnAnyDay(enrollment.class.meeting_slots)
              const continuation = isMeetingSlotContinuation(enrollment.class.meeting_slots, { day_type: dayType, period_number: period })
              const conflicted = conflictedIds.has(enrollment.id)
              return (
                <div className={`schedule-cell filled-cell ${isDoublePeriod ? 'is-multi-period' : ''} ${continuation ? 'is-continuation' : ''} ${conflicted ? 'has-conflict' : ''}`} role="gridcell" data-day={dayType} data-period={period} data-continuation={continuation || undefined} key={dayType}>
                  {conflicted ? <AlertTriangle className="conflict-icon" size={18} aria-label="Schedule conflict" /> : null}
                  <div className="class-cell-copy">
                    <strong>{continuation ? `${enrollment.class.course_name} — continues` : enrollment.class.course_name}</strong>
                    <span>{continuation ? 'Continues from previous period' : enrollment.class.teacher_last_name}</span>
                    {hasMultiplePeriods && !continuation ? <small>{dayType} Day · {daySlots.map((slot) => `P${slot.period_number}`).join(' + ')}</small> : null}
                  </div>
                  {!readOnly ? <details className="cell-menu">
                    <summary aria-label={`Actions for ${enrollment.class.course_name}`}><MoreVertical size={18} aria-hidden="true" /></summary>
                    <div className="cell-menu-popover">
                      <label>Academic term
                        <select value={enrollment.academic_term} onChange={(event) => onTermChange(enrollment, event.target.value as AcademicTerm)}>
                          <option value="full_year">Full Year</option>
                          <option value="semester_1">Semester 1</option>
                          <option value="semester_2">Semester 2</option>
                        </select>
                      </label>
                      <button type="button" onClick={() => onReplace(enrollment, dayType, period)}>Replace class</button>
                      <button className="danger-text" type="button" onClick={() => onRemove(enrollment)}>Remove class</button>
                    </div>
                  </details> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {!readOnly ? <p className="schedule-help">Click “Add class” to search and add. Classes with multiple meeting slots appear in every selected cell.</p> : null}
    </div>
  )
}
