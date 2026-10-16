import type { DayType, MeetingSlot } from '../../lib/domain'
import {
  buildNormalMeetingSlots,
  meetingDaySelectionFromSlots,
  meetingSlotsForDay,
  PERIOD_NUMBERS,
  sortMeetingSlots,
  type MeetingDaySelection,
} from '../../lib/schedule'
import { MeetingSlotGrid, MeetingSlotSummary } from './MeetingSlotGrid'

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
  const selectedPeriod = meetingDays === 'B' ? bPeriod : aPeriod

  function changeMeetingDays(nextDays: MeetingDaySelection) {
    onMeetingSlotsChange(sortMeetingSlots(buildNormalMeetingSlots(nextDays, selectedPeriod)))
  }

  function changePeriod(dayType: DayType, period: number) {
    if (meetingDays === 'both') {
      onMeetingSlotsChange(sortMeetingSlots(buildNormalMeetingSlots('both', period)))
      return
    }
    onMeetingSlotsChange(sortMeetingSlots([
      ...meetingSlots.filter((slot) => slot.day_type !== dayType),
      { day_type: dayType, period_number: period },
    ]))
  }

  return (
    <div className="schedule-slot-editor">
      <label className="checkbox-row">
        <input type="checkbox" checked={isDoublePeriod} onChange={(event) => onDoublePeriodChange(event.target.checked)} />
        <span><strong>Double-period class</strong><small>Pick each period on A and B days, for classes that run two periods in a row.</small></span>
      </label>
      {isDoublePeriod ? <MeetingSlotGrid meetingSlots={meetingSlots} onChange={onMeetingSlotsChange} /> : (
        <fieldset className="schedule-slot-picker">
          <legend>Meeting slots</legend>
          <p className="schedule-slot-help">Choose the days and period this class meets.</p>
          <div className="schedule-slot-fields">
            <label className="field">
              <span>Meeting days</span>
              <select value={meetingDays} onChange={(event) => changeMeetingDays(event.target.value as MeetingDaySelection)}>
                <option value="both">Both A and B days</option>
                <option value="A">A days only</option>
                <option value="B">B days only</option>
              </select>
            </label>
            <PeriodSelect dayType={meetingDays === 'B' ? 'B' : 'A'} value={selectedPeriod} onChange={changePeriod} />
          </div>
          <MeetingSlotSummary meetingSlots={meetingSlots} />
        </fieldset>
      )}
    </div>
  )
}

function PeriodSelect({ dayType, value, onChange }: {
  dayType: DayType
  value: number
  onChange: (dayType: DayType, period: number) => void
}) {
  return (
    <label className="field">
      <span>Period</span>
      <select value={value} onChange={(event) => onChange(dayType, Number(event.target.value))}>
        {PERIOD_NUMBERS.map((period) => <option value={period} key={period}>Period {period}</option>)}
      </select>
    </label>
  )
}

export function preferredMeetingDay(meetingSlots: MeetingSlot[]): DayType {
  return meetingSlots.find((slot) => slot.day_type === 'A')?.day_type ?? meetingSlots[0]?.day_type ?? 'A'
}
