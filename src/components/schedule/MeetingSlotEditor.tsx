import type { DayType, MeetingSlot } from '../../lib/domain'
import {
  formatMeetingSlotSummary,
  meetingDaySelectionFromSlots,
  meetingSlotsForDay,
  PERIOD_NUMBERS,
  sortMeetingSlots,
  type MeetingDaySelection,
} from '../../lib/schedule'
import { MeetingSlotGrid } from './MeetingSlotGrid'

interface MeetingSlotEditorProps {
  isDoublePeriod: boolean
  meetingSlots: MeetingSlot[]
  onDoublePeriodChange: (isDoublePeriod: boolean) => void
  onMeetingSlotsChange: (meetingSlots: MeetingSlot[]) => void
}

function periodForDay(meetingSlots: MeetingSlot[], dayType: DayType, fallback: number): number {
  return meetingSlotsForDay(meetingSlots, dayType)[0]?.period_number ?? fallback
}

export function MeetingSlotEditor({
  isDoublePeriod,
  meetingSlots,
  onDoublePeriodChange,
  onMeetingSlotsChange,
}: MeetingSlotEditorProps) {
  const meetingDays = meetingDaySelectionFromSlots(meetingSlots)
  const fallbackPeriod = meetingSlots[0]?.period_number ?? 1
  const aPeriod = periodForDay(meetingSlots, 'A', fallbackPeriod)
  const bPeriod = periodForDay(meetingSlots, 'B', fallbackPeriod)

  function changeMeetingDays(nextDays: MeetingDaySelection) {
    const nextSlots: MeetingSlot[] = []
    if (nextDays === 'both' || nextDays === 'A') nextSlots.push({ day_type: 'A', period_number: aPeriod })
    if (nextDays === 'both' || nextDays === 'B') nextSlots.push({ day_type: 'B', period_number: bPeriod })
    onMeetingSlotsChange(sortMeetingSlots(nextSlots))
  }

  function changePeriod(dayType: DayType, period: number) {
    onMeetingSlotsChange(sortMeetingSlots([
      ...meetingSlots.filter((slot) => slot.day_type !== dayType),
      { day_type: dayType, period_number: period },
    ]))
  }

  return (
    <>
      <label className="checkbox-row">
        <input type="checkbox" checked={isDoublePeriod} onChange={(event) => onDoublePeriodChange(event.target.checked)} />
        <span><strong>Double-period class</strong><small>Use the full A/B-day grid for independent consecutive periods.</small></span>
      </label>
      {isDoublePeriod ? <MeetingSlotGrid meetingSlots={meetingSlots} onChange={onMeetingSlotsChange} /> : (
        <fieldset className="meeting-slot-picker normal-slot-picker">
          <legend>Meeting slots</legend>
          <p className="meeting-slot-help">Choose the meeting days and the period used on each day.</p>
          <div className="two-field-row">
            <label>Meeting days
              <select value={meetingDays} onChange={(event) => changeMeetingDays(event.target.value as MeetingDaySelection)}>
                <option value="both">Both A and B days</option>
                <option value="A">A day only</option>
                <option value="B">B day only</option>
              </select>
            </label>
            {meetingDays === 'A' ? <PeriodSelect dayType="A" value={aPeriod} onChange={changePeriod} compact /> : null}
            {meetingDays === 'B' ? <PeriodSelect dayType="B" value={bPeriod} onChange={changePeriod} compact /> : null}
          </div>
          {meetingDays === 'both' ? <div className="two-field-row">
            <PeriodSelect dayType="A" value={aPeriod} onChange={changePeriod} />
            <PeriodSelect dayType="B" value={bPeriod} onChange={changePeriod} />
          </div> : null}
          <p className="inferred-slot" aria-live="polite">Meeting slots: <strong>{formatMeetingSlotSummary(meetingSlots)}</strong></p>
        </fieldset>
      )}
    </>
  )
}

function PeriodSelect({ dayType, value, compact = false, onChange }: {
  dayType: DayType
  value: number
  compact?: boolean
  onChange: (dayType: DayType, period: number) => void
}) {
  return <label>{compact ? 'Period' : `${dayType} day period`}
    <select value={value} onChange={(event) => onChange(dayType, Number(event.target.value))}>
      {PERIOD_NUMBERS.map((period) => <option value={period} key={period}>Period {period}</option>)}
    </select>
  </label>
}

export function preferredMeetingDay(meetingSlots: MeetingSlot[]): DayType {
  return meetingSlots.find((slot) => slot.day_type === 'A')?.day_type ?? meetingSlots[0]?.day_type ?? 'A'
}
