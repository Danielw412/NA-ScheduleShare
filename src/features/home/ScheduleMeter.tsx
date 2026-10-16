import type { DayType, ScheduleEnrollment } from '../../lib/domain'
import { filledScheduleSlots, PERIOD_NUMBERS } from '../../lib/schedule'

export { filledScheduleSlots }

const DAYS: DayType[] = ['A', 'B']

/**
 * Eighteen cells, one per A/B period, showing at a glance which periods of
 * the student's week are filled in.
 */
export function ScheduleMeter({ enrollments }: { enrollments: ScheduleEnrollment[] }) {
  const filled = filledScheduleSlots(enrollments)
  return (
    <div className="schedule-meter" aria-hidden="true">
      {DAYS.map((day) => (
        <div className="schedule-meter-row" key={day}>
          <span className="schedule-meter-day">{day}</span>
          {PERIOD_NUMBERS.map((period) => (
            <span className={filled.has(`${day}-${period}`) ? 'schedule-meter-cell is-filled' : 'schedule-meter-cell'} key={period}>{period}</span>
          ))}
        </div>
      ))}
    </div>
  )
}
