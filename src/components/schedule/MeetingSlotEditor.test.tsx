import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultDoubleMeetingSlots, defaultMeetingSlots, meetingSlotsForDay, sortMeetingSlots } from '../../lib/schedule'
import type { DayType, MeetingSlot } from '../../lib/domain'
import { MeetingSlotEditor } from './MeetingSlotEditor'

afterEach(() => {
  document.body.innerHTML = ''
})

function EditorHarness() {
  const [isDoublePeriod, setIsDoublePeriod] = useState(false)
  const [meetingSlots, setMeetingSlots] = useState<MeetingSlot[]>(defaultMeetingSlots('A', 4))

  return <MeetingSlotEditor
    isDoublePeriod={isDoublePeriod}
    meetingSlots={meetingSlots}
    onDoublePeriodChange={(next) => {
      setIsDoublePeriod(next)
      if (next) setMeetingSlots(defaultDoubleMeetingSlots('A', 4))
      else setMeetingSlots(sortMeetingSlots((['A', 'B'] as DayType[]).flatMap((day) => meetingSlotsForDay(meetingSlots, day).slice(0, 1))))
    }}
    onMeetingSlotsChange={setMeetingSlots}
  />
}

describe('MeetingSlotEditor', () => {
  it('defaults normal classes to both days and the clicked period without showing the grid', () => {
    render(<EditorHarness />)

    expect(screen.getByRole('combobox', { name: 'Meeting days' })).toHaveValue('both')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('4')
    expect(screen.queryByRole('combobox', { name: 'A day period' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'B day period' })).not.toBeInTheDocument()
    expect(screen.getByText('P4', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
  })

  it('uses one shared period for both days and supports A-only or B-only classes', async () => {
    const user = userEvent.setup()
    render(<EditorHarness />)
    const days = screen.getByRole('combobox', { name: 'Meeting days' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '5')
    expect(screen.getByText('P5', { selector: 'strong' })).toBeInTheDocument()
    await user.selectOptions(days, 'A')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('5')
    expect(screen.getByText('A P5', { selector: 'strong' })).toBeInTheDocument()
    await user.selectOptions(days, 'B')
    expect(screen.getByText('B P5', { selector: 'strong' })).toBeInTheDocument()
  })

  it('switches to the independent double-period grid and normalizes back', async () => {
    const user = userEvent.setup()
    render(<EditorHarness />)
    const toggle = screen.getByRole('checkbox', { name: /Double-period class/ })

    await user.click(toggle)
    expect(screen.getAllByRole('columnheader')).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'A Day, Period 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'A Day, Period 5' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
    expect(screen.getByText('P4', { selector: 'strong' })).toBeInTheDocument()
  })
})
