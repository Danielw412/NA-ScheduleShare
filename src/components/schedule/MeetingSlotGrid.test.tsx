import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import styles from '../../styles.css?raw'
import type { MeetingSlot } from '../../lib/domain'
import { getCssDeclarations } from '../../test/css'
import { MeetingSlotGrid } from './MeetingSlotGrid'

afterEach(cleanup)

function EditableGrid({ initialSlots }: { initialSlots: MeetingSlot[] }) {
  const [meetingSlots, setMeetingSlots] = useState(initialSlots)
  return <MeetingSlotGrid meetingSlots={meetingSlots} onChange={setMeetingSlots} />
}

describe('MeetingSlotGrid', () => {
  it('loads an existing asymmetric class and edits each A/B slot independently', async () => {
    const user = userEvent.setup()
    render(<EditableGrid initialSlots={[
      { day_type: 'A', period_number: 4 },
      { day_type: 'B', period_number: 3 },
      { day_type: 'B', period_number: 4 },
    ]} />)

    expect(screen.getByRole('button', { name: 'A Day, Period 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'A Day, Period 3' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'B Day, Period 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('B P3 · P4', { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'B Day, Period 3' }))
    await user.click(screen.getByRole('button', { name: 'A Day, Period 1' }))

    expect(screen.getByRole('button', { name: 'B Day, Period 3' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('A P1 · P4', { selector: 'strong' })).toBeInTheDocument()
  })

  it('loads every slot for an existing double-period class without inferring extras', () => {
    render(<EditableGrid initialSlots={[
      { day_type: 'A', period_number: 7 },
      { day_type: 'A', period_number: 8 },
      { day_type: 'B', period_number: 7 },
      { day_type: 'B', period_number: 8 },
    ]} />)

    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'A Day, Period 6' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'B Day, Period 9' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports arrow-key navigation between labeled cells', () => {
    render(<EditableGrid initialSlots={[]} />)
    const aDayPeriodFour = screen.getByRole('button', { name: 'A Day, Period 4' })
    const bDayPeriodFour = screen.getByRole('button', { name: 'B Day, Period 4' })

    aDayPeriodFour.focus()
    fireEvent.keyDown(aDayPeriodFour, { key: 'ArrowDown' })
    expect(bDayPeriodFour).toHaveFocus()
    fireEvent.keyDown(bDayPeriodFour, { key: 'End' })
    expect(screen.getByRole('button', { name: 'B Day, Period 9' })).toHaveFocus()
  })

  it('keeps the full labeled grid horizontally scrollable on mobile', () => {
    render(<EditableGrid initialSlots={[]} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(10)
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
    expect(getCssDeclarations(styles, '.meeting-slot-grid-scroll')).toMatchObject({
      'min-width': '0',
      'overflow-x': 'auto',
    })
    expect(getCssDeclarations(styles, '.meeting-slot-grid')).toMatchObject({
      width: '100%',
      'min-width': '520px',
    })
  })
})
