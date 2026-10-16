import { Check } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { DayType, MeetingSlot } from '../../lib/domain'
import { PERIOD_NUMBERS, sameSlot, toggleMeetingSlot } from '../../lib/schedule'
import { meetingSlotFacts } from './periodLabels'

interface MeetingSlotGridProps {
  meetingSlots: MeetingSlot[]
  onChange: (meetingSlots: MeetingSlot[]) => void
}

const DAY_TYPES: DayType[] = ['A', 'B']

/**
 * Rows are periods and columns are days, so arrow keys follow the layout:
 * up/down changes the period, left/right the day, Home/End jump to the
 * first or last period.
 */
function moveGridFocus(event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) {
  let nextRow = rowIndex
  let nextColumn = columnIndex

  switch (event.key) {
    case 'ArrowUp':
      nextRow = Math.max(0, rowIndex - 1)
      break
    case 'ArrowDown':
      nextRow = Math.min(PERIOD_NUMBERS.length - 1, rowIndex + 1)
      break
    case 'ArrowLeft':
      nextColumn = Math.max(0, columnIndex - 1)
      break
    case 'ArrowRight':
      nextColumn = Math.min(DAY_TYPES.length - 1, columnIndex + 1)
      break
    case 'Home':
      nextRow = 0
      break
    case 'End':
      nextRow = PERIOD_NUMBERS.length - 1
      break
    default:
      return
  }

  event.preventDefault()
  event.currentTarget.closest('table')
    ?.querySelector<HTMLButtonElement>(`[data-slot-row="${nextRow}"][data-slot-column="${nextColumn}"]`)
    ?.focus()
}

/** The chosen meeting slots as plain-language chips. Shared by both slot pickers. */
export function MeetingSlotSummary({ meetingSlots }: { meetingSlots: MeetingSlot[] }) {
  const facts = meetingSlotFacts(meetingSlots)
  return (
    <p className="schedule-slot-summary" aria-live="polite">
      <span className="schedule-slot-summary-label">Meets</span>
      {facts.length > 0
        ? facts.map((fact) => <span className="chip" key={fact}>{fact}</span>)
        : <span className="schedule-slot-summary-empty">No periods selected</span>}
    </p>
  )
}

/** Independent A/B-day period picker for double-period and irregular classes. */
export function MeetingSlotGrid({ meetingSlots, onChange }: MeetingSlotGridProps) {
  return (
    <fieldset className="schedule-slot-picker is-grid">
      <legend>Meeting slots</legend>
      <p className="schedule-slot-help">Select every period this class meets. Arrow keys move between periods and days.</p>
      <table className="schedule-slot-grid">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Period</span></th>
            {DAY_TYPES.map((dayType) => <th scope="col" key={dayType}>{dayType} day</th>)}
          </tr>
        </thead>
        <tbody>
          {PERIOD_NUMBERS.map((period, rowIndex) => (
            <tr key={period}>
              <th scope="row"><span className="sr-only">Period </span><span className="period-numeral">{period}</span></th>
              {DAY_TYPES.map((dayType, columnIndex) => {
                const slot: MeetingSlot = { day_type: dayType, period_number: period }
                const selected = meetingSlots.some((candidate) => sameSlot(candidate, slot))
                return (
                  <td key={dayType}>
                    <button
                      aria-label={`${dayType} Day, Period ${period}`}
                      aria-pressed={selected}
                      className="schedule-slot-toggle"
                      data-slot-column={columnIndex}
                      data-slot-row={rowIndex}
                      onClick={() => onChange(toggleMeetingSlot(meetingSlots, slot))}
                      onKeyDown={(event) => moveGridFocus(event, rowIndex, columnIndex)}
                      type="button"
                    >
                      {selected ? <Check aria-hidden="true" /> : null}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <MeetingSlotSummary meetingSlots={meetingSlots} />
    </fieldset>
  )
}
