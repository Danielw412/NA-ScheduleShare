import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildNormalMeetingSlots, defaultDoubleMeetingSlots, type MeetingDaySelection } from '../../lib/schedule'
import type { MeetingSlot } from '../../lib/domain'
import { MeetingSlotEditor } from './MeetingSlotEditor'

afterEach(() => {
  document.body.innerHTML = ''
})

function EditorHarness() {
  const [isDoublePeriod, setIsDoublePeriod] = useState(false)
  const [meetingDays, setMeetingDays] = useState<MeetingDaySelection>('both')
  const [meetingPeriod, setMeetingPeriod] = useState(4)
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(buildNormalMeetingSlots('both', 4))

  return <MeetingSlotEditor
    isDoublePeriod={isDoublePeriod}
    meetingSlots={meetingSlots}
    meetingDays={meetingDays}
    meetingPeriod={meetingPeriod}
    onDoublePeriodChange={(next) => {
      setIsDoublePeriod(next)
      setMeetingSlots(next ? defaultDoubleMeetingSlots('A', meetingPeriod) : buildNormalMeetingSlots(meetingDays, meetingPeriod))
    }}
    onMeetingDaysChange={(next) => {
      setMeetingDays(next)
      if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(next, meetingPeriod))
    }}
    onMeetingPeriodChange={(next) => {
      setMeetingPeriod(next)
      if (!isDoublePeriod) setMeetingSlots(buildNormalMeetingSlots(meetingDays, next))
    }}
    onMeetingSlotsChange={setMeetingSlots}
  />
}

describe('MeetingSlotEditor', () => {
  it('defaults normal classes to both days and the clicked period without showing the grid', () => {
    render(<EditorHarness />)

    expect(screen.getByRole('combobox', { name: 'Meeting days' })).toHaveValue('both')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('4')
    expect(screen.getByText(/A Day.*P4.*B Day.*P4/)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
  })

  it('supports A-only and B-only normal selections', async () => {
    const user = userEvent.setup()
    render(<EditorHarness />)
    const days = screen.getByRole('combobox', { name: 'Meeting days' })

    await user.selectOptions(days, 'A')
    expect(screen.getByText(/A Day.*P4/)).toBeInTheDocument()
    expect(screen.queryByText(/B Day.*P4/)).not.toBeInTheDocument()
    await user.selectOptions(days, 'B')
    expect(screen.getByText(/B Day.*P4/)).toBeInTheDocument()
    expect(screen.queryByText(/A Day.*P4/)).not.toBeInTheDocument()
  })

  it('switches to the independent grid and normalizes back to one period per selected day', async () => {
    const user = userEvent.setup()
    render(<EditorHarness />)
    const toggle = screen.getByRole('checkbox', { name: /Double-period class/ })

    await user.click(toggle)
    expect(screen.getAllByRole('columnheader')).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'A Day, Period 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'A Day, Period 5' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
    expect(screen.getByText(/A Day.*P4.*B Day.*P4/)).toBeInTheDocument()
  })
})
