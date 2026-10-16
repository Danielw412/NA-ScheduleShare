import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import styles from '../../styles/features/schedule.css?raw'
import type { MeetingSlot } from '../../lib/domain'
import { getCssDeclarations } from '../../test/css'
import { MeetingSlotGrid } from './MeetingSlotGrid'
import { meetingSlotFacts, periodsLabel } from './periodLabels'

afterEach(cleanup)

function EditableGrid({ initialSlots }: { initialSlots: MeetingSlot[] }) {
  const [meetingSlots, setMeetingSlots] = useState(initialSlots)
  return <MeetingSlotGrid meetingSlots={meetingSlots} onChange={setMeetingSlots} />
}

function summary() {
  return document.querySelector('.schedule-slot-summary') as HTMLElement
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
    expect(within(summary()).getByText('A day, period 4')).toHaveClass('chip')
    expect(within(summary()).getByText('B day, periods 3–4')).toHaveClass('chip')

    await user.click(screen.getByRole('button', { name: 'B Day, Period 3' }))
    await user.click(screen.getByRole('button', { name: 'A Day, Period 1' }))

    expect(screen.getByRole('button', { name: 'B Day, Period 3' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(summary()).getByText('A day, periods 1 and 4')).toBeInTheDocument()
    expect(within(summary()).getByText('B day, period 4')).toBeInTheDocument()
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
    expect(within(summary()).getByText('Periods 7–8, A and B days')).toBeInTheDocument()
  })

  it('says when no period is selected', async () => {
    const user = userEvent.setup()
    render(<EditableGrid initialSlots={[{ day_type: 'A', period_number: 2 }]} />)

    await user.click(screen.getByRole('button', { name: 'A Day, Period 2' }))
    expect(summary()).toHaveTextContent('MeetsNo periods selected')
    expect(summary()).toHaveAttribute('aria-live', 'polite')
  })

  it('supports arrow-key navigation that follows the periods-down, days-across layout', () => {
    render(<EditableGrid initialSlots={[]} />)
    const aDayPeriodFour = screen.getByRole('button', { name: 'A Day, Period 4' })

    aDayPeriodFour.focus()
    fireEvent.keyDown(aDayPeriodFour, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'A Day, Period 5' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'B Day, Period 5' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'B Day, Period 4' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' })
    expect(screen.getByRole('button', { name: 'B Day, Period 9' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    expect(screen.getByRole('button', { name: 'B Day, Period 1' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'A Day, Period 1' })).toHaveFocus()
  })

  it('lists periods down the side so the picker fits a phone without scrolling sideways', () => {
    render(<EditableGrid initialSlots={[]} />)
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Period', 'A day', 'B day'])
    const rowHeaders = screen.getAllByRole('rowheader')
    expect(rowHeaders).toHaveLength(9)
    expect(rowHeaders[0]).toHaveTextContent('Period 1')
    expect(rowHeaders[0].querySelector('.period-numeral')).toHaveTextContent('1')

    expect(getCssDeclarations(styles, '.schedule-slot-grid')).toMatchObject({ 'max-width': '372px' })
    expect(getCssDeclarations(styles, '.schedule-slot-toggle')).toMatchObject({ width: '100%', 'min-height': '44px' })
  })
})

describe('meeting slot labels', () => {
  it('describes periods in plain language', () => {
    expect(periodsLabel([5])).toBe('Period 5')
    expect(periodsLabel([8, 7])).toBe('Periods 7–8')
    expect(periodsLabel([2, 6, 4])).toBe('Periods 2, 4 and 6')
    expect(meetingSlotFacts([])).toEqual([])
    expect(meetingSlotFacts([{ day_type: 'B', period_number: 5 }])).toEqual(['B day, period 5'])
    expect(meetingSlotFacts([{ day_type: 'A', period_number: 5 }, { day_type: 'B', period_number: 5 }])).toEqual(['Period 5, A and B days'])
  })
})
