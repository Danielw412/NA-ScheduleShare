import type { KeyboardEvent } from 'react'
import type { DayType, MeetingSlot } from '../../lib/domain'
import { formatMeetingSlotSummary, PERIOD_NUMBERS, sameSlot, toggleMeetingSlot } from '../../lib/schedule'

interface MeetingSlotGridProps {
  meetingSlots: MeetingSlot[]
  onChange: (meetingSlots: MeetingSlot[]) => void
}

const DAY_TYPES: DayType[] = ['A', 'B']

function moveGridFocus(event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) {
  let nextRow = rowIndex
  let nextColumn = columnIndex

  switch (event.key) {
    case 'ArrowLeft':
      nextColumn = Math.max(0, columnIndex - 1)
      break
    case 'ArrowRight':
      nextColumn = Math.min(PERIOD_NUMBERS.length - 1, columnIndex + 1)
      break
    case 'ArrowUp':
      nextRow = Math.max(0, rowIndex - 1)
      break
    case 'ArrowDown':
      nextRow = Math.min(DAY_TYPES.length - 1, rowIndex + 1)
      break
    case 'Home':
      nextColumn = 0
      break
    case 'End':
      nextColumn = PERIOD_NUMBERS.length - 1
      break
    default:
      return
  }

  event.preventDefault()
  event.currentTarget.closest('table')
    ?.querySelector<HTMLButtonElement>(`[data-slot-row="${nextRow}"][data-slot-column="${nextColumn}"]`)
    ?.focus()
}

export function MeetingSlotGrid({ meetingSlots, onChange }: MeetingSlotGridProps) {
  const summary = formatMeetingSlotSummary(meetingSlots)

  return (
    <fieldset className="meeting-slot-picker">
      <legend>Meeting slots</legend>
      <p className="meeting-slot-help">Select every period when this class meets. Use arrow keys to move between cells.</p>
      <div className="meeting-slot-grid-scroll">
        <table className="meeting-slot-grid">
          <thead>
            <tr>
              <th scope="col">Day</th>
              {PERIOD_NUMBERS.map((period) => <th scope="col" key={period}>P{period}</th>)}
            </tr>
          </thead>
          <tbody>
            {DAY_TYPES.map((dayType, rowIndex) => (
              <tr key={dayType}>
                <th scope="row">{dayType} Day</th>
                {PERIOD_NUMBERS.map((period, columnIndex) => {
                  const slot: MeetingSlot = { day_type: dayType, period_number: period }
                  const selected = meetingSlots.some((candidate) => sameSlot(candidate, slot))
                  return (
                    <td key={period}>
                      <button
                        aria-label={`${dayType} Day, Period ${period}`}
                        aria-pressed={selected}
                        className="meeting-slot-toggle"
                        data-slot-column={columnIndex}
                        data-slot-row={rowIndex}
                        onClick={() => onChange(toggleMeetingSlot(meetingSlots, slot))}
                        onKeyDown={(event) => moveGridFocus(event, rowIndex, columnIndex)}
                        type="button"
                      >
                        <span aria-hidden="true">{selected ? '✓' : ''}</span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inferred-slot" aria-live="polite">Meeting slots: <strong>{summary || 'None selected'}</strong></p>
    </fieldset>
  )
}
