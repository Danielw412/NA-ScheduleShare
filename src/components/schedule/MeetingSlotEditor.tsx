import type { DayType, MeetingSlot } from '../../lib/domain'
import { buildNormalMeetingSlots, formatMeetingSlotSummary, PERIOD_NUMBERS, type MeetingDaySelection } from '../../lib/schedule'
import { MeetingSlotGrid } from './MeetingSlotGrid'

interface MeetingSlotEditorProps {
  isDoublePeriod: boolean
  meetingSlots: MeetingSlot[]
  meetingDays: MeetingDaySelection
  meetingPeriod: number
  onDoublePeriodChange: (isDoublePeriod: boolean) => void
  onMeetingDaysChange: (meetingDays: MeetingDaySelection) => void
  onMeetingPeriodChange: (period: number) => void
  onMeetingSlotsChange: (meetingSlots: MeetingSlot[]) => void
}

export function MeetingSlotEditor({
  isDoublePeriod,
  meetingSlots,
  meetingDays,
  meetingPeriod,
  onDoublePeriodChange,
  onMeetingDaysChange,
  onMeetingPeriodChange,
  onMeetingSlotsChange,
}: MeetingSlotEditorProps) {
  return (
    <>
      <label className="checkbox-row">
        <input type="checkbox" checked={isDoublePeriod} onChange={(event) => onDoublePeriodChange(event.target.checked)} />
        <span><strong>Double-period class</strong><small>Use the full A/B-day grid for independent consecutive periods.</small></span>
      </label>
      {isDoublePeriod ? <MeetingSlotGrid meetingSlots={meetingSlots} onChange={onMeetingSlotsChange} /> : (
        <fieldset className="meeting-slot-picker normal-slot-picker">
          <legend>Meeting slots</legend>
          <p className="meeting-slot-help">Choose which days this class meets and the one period used on each selected day.</p>
          <div className="two-field-row">
            <label>Meeting days
              <select value={meetingDays} onChange={(event) => onMeetingDaysChange(event.target.value as MeetingDaySelection)}>
                <option value="both">Both A and B days</option>
                <option value="A">A day only</option>
                <option value="B">B day only</option>
              </select>
            </label>
            <label>Period
              <select value={meetingPeriod} onChange={(event) => onMeetingPeriodChange(Number(event.target.value))}>
                {PERIOD_NUMBERS.map((period) => <option value={period} key={period}>Period {period}</option>)}
              </select>
            </label>
          </div>
          <p className="inferred-slot" aria-live="polite">Meeting slots: <strong>{formatMeetingSlotSummary(buildNormalMeetingSlots(meetingDays, meetingPeriod))}</strong></p>
        </fieldset>
      )}
    </>
  )
}

export function preferredMeetingDay(meetingSlots: MeetingSlot[]): DayType {
  return meetingSlots.find((slot) => slot.day_type === 'A')?.day_type ?? meetingSlots[0]?.day_type ?? 'A'
}
