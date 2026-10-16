import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import styles from '../../styles/features/schedule.css?raw'
import type { ScheduleEnrollment } from '../../lib/domain'
import { getCssDeclarations } from '../../test/css'
import { ScheduleGrid } from './ScheduleGrid'
import { TermSelector } from './TermSelector'

const doublePeriod: ScheduleEnrollment = {
  id: 'enrollment-double',
  class_id: 'class-double',
  student_id: 'student',
  academic_term: 'full_year',
  active: true,
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
  class: {
    id: 'class-double',
    course_name_id: 'course-physics',
    course_name: 'AP Physics 1&2',
    teacher_last_name: 'Neff',
    default_academic_term: 'full_year',
    is_double_period: true,
    meeting_slots: [
      { day_type: 'A', period_number: 7 },
      { day_type: 'A', period_number: 8 },
    ],
  },
}

function singleClass(id: string, courseName: string, teacher: string, period: number, extra: Partial<ScheduleEnrollment> = {}): ScheduleEnrollment {
  const meetingSlots = [{ day_type: 'A' as const, period_number: period }, { day_type: 'B' as const, period_number: period }]
  return {
    ...doublePeriod,
    id,
    class_id: `class-${id}`,
    ...extra,
    class: {
      ...doublePeriod.class,
      id: `class-${id}`,
      course_name: courseName,
      teacher_last_name: teacher,
      is_double_period: false,
      meeting_slots: meetingSlots,
    },
  }
}

const callbacks = {
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReplace: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function periodRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-period'))
}

describe('ScheduleGrid structure', () => {
  it('renders a header row and one row per period with an A and B position each', () => {
    const { container, rerender } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)

    expect(screen.getAllByRole('row')).toHaveLength(10)
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Period', 'A day', 'B day'])
    const rows = periodRows()
    expect(rows).toHaveLength(9)
    for (const [index, row] of rows.entries()) {
      expect(row).toHaveAttribute('data-period', String(index + 1))
      expect(within(row).getByRole('rowheader')).toHaveTextContent(`Period ${index + 1}`)
      expect(row.querySelectorAll('[role="gridcell"][data-day]')).toHaveLength(2)
    }

    const periodSeven = container.querySelector('.schedule-row[data-period="7"]')
    const periodEight = container.querySelector('.schedule-row[data-period="8"]')
    expect(periodSeven?.querySelector('[data-day="A"]')).toHaveClass('is-filled')
    expect(periodEight?.querySelector('[data-day="A"]')).toHaveAttribute('data-continuation', 'true')
    expect(periodSeven?.querySelector('[data-day="B"]')).toHaveClass('is-empty')

    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    expect(periodRows()).toHaveLength(9)
    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_2" {...callbacks} />)
    expect(periodRows()).toHaveLength(9)
  })

  it('merges consecutive periods of a double-period class into one block', () => {
    const { container } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    const start = container.querySelector('[data-day="A"][data-period="7"]')
    const covered = container.querySelector('[data-day="A"][data-period="8"]')

    expect(start).toHaveAttribute('aria-rowspan', '2')
    expect(start).toHaveClass('is-block')
    expect(start).toHaveStyle({ gridRow: '8 / span 2' })
    expect(within(start as HTMLElement).getByText('Periods 7–8')).toBeInTheDocument()
    expect(covered).toHaveAttribute('hidden')
    expect(covered).toHaveClass('is-merged')
    // The covered position drops out of the accessibility tree, so period 8 exposes only the B-day cell.
    expect(within(periodRows()[7]).getAllByRole('gridcell')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Actions for AP Physics 1&2' })).toHaveLength(1)

    expect(getCssDeclarations(styles, '.schedule-cell[hidden]')).toMatchObject({ display: 'none' })
    expect(getCssDeclarations(styles, '.schedule-grid')).toMatchObject({
      display: 'grid',
      'grid-template-columns': '72px repeat(2, minmax(0, 1fr))',
      'row-gap': '0',
    })
  })

  it('renders asymmetric per-day slots and only marks consecutive cells as continuations', () => {
    const asymmetric: ScheduleEnrollment = {
      ...doublePeriod,
      id: 'enrollment-asymmetric',
      class_id: 'class-asymmetric',
      class: {
        ...doublePeriod.class,
        id: 'class-asymmetric',
        is_double_period: true,
        meeting_slots: [
          { day_type: 'A', period_number: 4 },
          { day_type: 'B', period_number: 3 },
          { day_type: 'B', period_number: 4 },
        ],
      },
    }
    const { container } = render(<ScheduleGrid enrollments={[asymmetric]} selectedTerm="semester_1" {...callbacks} />)

    expect(container.querySelector('[data-day="A"][data-period="4"]')).not.toHaveAttribute('data-continuation')
    expect(container.querySelector('[data-day="B"][data-period="3"]')).not.toHaveAttribute('data-continuation')
    expect(container.querySelector('[data-day="B"][data-period="4"]')).toHaveAttribute('data-continuation', 'true')
    expect(container.querySelector('[data-day="A"][data-period="4"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="3"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="4"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="3"]')).toHaveClass('is-empty')
    expect(container.querySelector('[data-day="A"][data-period="4"]')).not.toHaveAttribute('aria-rowspan')
    expect(screen.getByText('Periods 3–4')).toBeInTheDocument()
  })

  it('keeps an overlapping class visible instead of merging it into another class block', () => {
    const overlapping = singleClass('enrollment-overlap', 'Concert Band', 'Reed', 8)
    const { container } = render(<ScheduleGrid enrollments={[overlapping, doublePeriod]} selectedTerm="semester_1" {...callbacks} />)

    const periodEight = container.querySelector('[data-day="A"][data-period="8"]')
    expect(periodEight).not.toHaveAttribute('hidden')
    expect(periodEight).toHaveTextContent('Concert Band')
    expect(container.querySelector('[data-day="A"][data-period="7"]')).not.toHaveAttribute('aria-rowspan')
    // Physics in A7, and Concert Band in A8 and B8, each carry the conflict label.
    expect(screen.getAllByText('Conflict')).toHaveLength(3)
    expect(container.querySelectorAll('.is-conflict')).toHaveLength(3)
  })

  it('flags a conflict only in the semester where both classes meet', () => {
    const chemistry = singleClass('enrollment-chemistry', 'Chemistry', 'Patel', 3)
    const robotics = singleClass('enrollment-robotics', 'Robotics', 'Ito', 3, { academic_term: 'semester_2' })
    const { container, rerender } = render(<ScheduleGrid enrollments={[chemistry, robotics]} selectedTerm="semester_1" {...callbacks} />)

    // Robotics starts in Semester 2, so Chemistry has nothing to clash with yet.
    expect(screen.queryByText('Conflict')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.is-conflict')).toHaveLength(0)

    rerender(<ScheduleGrid enrollments={[chemistry, robotics]} selectedTerm="semester_2" {...callbacks} />)
    expect(screen.getAllByText('Conflict')).toHaveLength(2)
  })

  it('derives multi-period styling from slots when the stored flag is stale, but not for normal classes', () => {
    const derivedDouble: ScheduleEnrollment = {
      ...doublePeriod,
      id: 'enrollment-derived-double',
      class_id: 'class-derived-double',
      class: {
        ...doublePeriod.class,
        id: 'class-derived-double',
        is_double_period: false,
        meeting_slots: [
          { day_type: 'A', period_number: 2 },
          { day_type: 'A', period_number: 3 },
        ],
      },
    }
    const normal = singleClass('enrollment-normal', 'Chemistry', 'Patel', 5)
    const { container } = render(<ScheduleGrid enrollments={[derivedDouble, normal]} selectedTerm="semester_1" {...callbacks} />)

    expect(container.querySelector('[data-day="A"][data-period="2"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="3"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="5"]')).not.toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="5"]')).not.toHaveClass('is-multi-period')
  })

  it('shows course and teacher, and leaves out the N/A placeholder teacher for Lunch', () => {
    const lunch = singleClass('enrollment-lunch', 'Lunch - NASH', 'N/A', 5)
    const chemistry = singleClass('enrollment-chem', 'Chemistry', 'Patel', 2)
    render(<ScheduleGrid enrollments={[lunch, chemistry]} selectedTerm="semester_1" {...callbacks} readOnly />)

    expect(screen.getAllByRole('gridcell', { name: /Chemistry/ })[0]).toHaveTextContent('ChemistryPatel')
    expect(screen.getAllByText('Lunch - NASH')).toHaveLength(2)
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })
})

describe('ScheduleGrid editing', () => {
  it('labels every open period with its day and period and reports the slot when chosen', async () => {
    const user = userEvent.setup()
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Add class, B day period 7' }))
    expect(callbacks.onAdd).toHaveBeenCalledWith('B', 7)
    expect(screen.queryByRole('button', { name: 'Add class, A day period 7' })).not.toBeInTheDocument()
  })

  it('shows "No class" and no actions in read-only grids', () => {
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} readOnly />)

    expect(screen.queryByRole('button', { name: /Add class/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument()
    // 18 A/B periods minus the two A-day periods the double class fills.
    expect(screen.getAllByText('No class')).toHaveLength(16)
  })

  it('keeps only one action menu open and closes it when clicking elsewhere', async () => {
    const user = userEvent.setup()
    const chemistry = singleClass('enrollment-chem', 'Chemistry', 'Patel', 2)
    render(<ScheduleGrid enrollments={[doublePeriod, chemistry]} selectedTerm="semester_1" {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Actions for AP Physics 1&2' }))
    const menu = screen.getByRole('menu', { name: 'AP Physics 1&2 actions' })
    expect(screen.queryByRole('combobox', { name: 'Academic term' })).not.toBeInTheDocument()
    expect(within(menu).getByText('Full year')).toBeInTheDocument()
    expect(within(menu).getByText('A day')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Actions for Chemistry' })[1])
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(within(screen.getByRole('menu')).getByText('B day')).toBeInTheDocument()

    await user.click(screen.getByRole('grid'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('marks changed predicted courses without enabling edit actions', () => {
    const changed = new Set([doublePeriod.id])
    const { container } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" changedEnrollmentIds={changed} readOnly {...callbacks} />)

    expect(container.querySelectorAll('[data-predicted-change="true"]')).not.toHaveLength(0)
    expect(screen.getAllByText('Changed')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: `Actions for ${doublePeriod.class.course_name}` })).not.toBeInTheDocument()
  })

  it('supports arrow-key menu navigation and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    const trigger = screen.getByRole('button', { name: 'Actions for AP Physics 1&2' })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Edit or replace class' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Remove class' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Edit or replace class' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Remove class' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores focus after menu actions and viewport changes', async () => {
    const user = userEvent.setup()
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    const trigger = screen.getByRole('button', { name: 'Actions for AP Physics 1&2' })

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Remove class' }))
    expect(callbacks.onRemove).toHaveBeenCalledWith(doublePeriod)
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens the editor for flexible special-course attendance changes', async () => {
    const user = userEvent.setup()
    const gymEnrollment: ScheduleEnrollment = {
      ...doublePeriod,
      id: 'gym-enrollment',
      class_id: 'gym-class',
      class: { ...doublePeriod.class, id: 'gym-class', course_name: 'Unified Gym - Senior' },
    }
    render(<ScheduleGrid enrollments={[gymEnrollment]} selectedTerm="semester_1" {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Actions for Unified Gym - Senior' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit or replace class' }))
    expect(callbacks.onReplace).toHaveBeenCalledWith(gymEnrollment, 'A', 7)
  })
})

describe('ScheduleGrid today and phone layout', () => {
  it('marks today’s day and the class in session now', () => {
    const chemistry = singleClass('enrollment-chem', 'Chemistry', 'Patel', 2)
    const { container } = render(<ScheduleGrid enrollments={[chemistry]} selectedTerm="semester_1" todayDayType="B" currentPeriod={2} {...callbacks} />)

    const todayHeader = screen.getByRole('columnheader', { name: /B day/ })
    expect(todayHeader).toHaveClass('is-today')
    expect(todayHeader).toHaveTextContent('B dayToday')
    expect(screen.getByRole('columnheader', { name: 'A day' })).not.toHaveClass('is-today')
    const nowCell = container.querySelector('[data-day="B"][data-period="2"]')
    expect(nowCell).toHaveClass('is-now')
    expect(within(nowCell as HTMLElement).getByText('Now')).toBeInTheDocument()
    expect(container.querySelector('[data-day="A"][data-period="2"]')).not.toHaveClass('is-now')
    expect(container.querySelector('.schedule-period[data-period="2"] .period-numeral')).toHaveClass('is-now')
    expect(container.querySelector('.schedule-period[data-period="3"] .period-numeral')).not.toHaveClass('is-now')
  })

  it('marks a double-period block as now during its second period', () => {
    const { container } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" todayDayType="A" currentPeriod={8} {...callbacks} />)
    const block = container.querySelector('[data-day="A"][data-period="7"]')
    expect(block).toHaveClass('is-now')
    expect(within(block as HTMLElement).getByText('Now')).toBeInTheDocument()
    expect(container.querySelector('.schedule-period[data-period="8"] .period-numeral')).toHaveClass('is-now')
    expect(container.querySelector('[data-day="B"][data-period="8"]')).not.toHaveClass('is-now')
  })

  it('does not mark anything as now without a school day', () => {
    const { container } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" currentPeriod={7} {...callbacks} />)
    expect(container.querySelector('.is-now')).toBeNull()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('opens the phone view on today’s day and lets the student switch days', async () => {
    const user = userEvent.setup()
    const { container } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" todayDayType="B" {...callbacks} />)
    const daySwitch = screen.getByRole('radiogroup', { name: 'Day shown' })
    const grid = screen.getByRole('grid')

    expect(within(daySwitch).getByRole('radio', { name: /B day/ })).toBeChecked()
    expect(grid).toHaveClass('is-showing-b', 'is-showing-today')
    await user.click(within(daySwitch).getByRole('radio', { name: 'A day' }))
    expect(grid).toHaveClass('is-showing-a')
    expect(grid).not.toHaveClass('is-showing-today')
    expect(container.querySelector('.schedule-grid-wrap')).toContainElement(daySwitch)

    expect(getCssDeclarations(styles, '.schedule-grid-wrap')).toMatchObject({ container: 'schedule-grid / inline-size' })
    expect(getCssDeclarations(styles, '.schedule-day-switch.segmented')).toMatchObject({ display: 'none' })
    expect(getCssDeclarations(styles, '.schedule-grid.is-showing-a .schedule-cell[data-day="B"], .schedule-grid.is-showing-b .schedule-cell[data-day="A"]')).toMatchObject({ display: 'none' })
    expect(getCssDeclarations(styles, '.schedule-grid .schedule-cell[data-day]')).toMatchObject({ 'grid-column': '2' })
  })

  it('falls back to the default day when today is not a school day', () => {
    render(<ScheduleGrid enrollments={[]} selectedTerm="semester_1" defaultMobileDay="B" {...callbacks} />)
    expect(screen.getByRole('radio', { name: 'B day' })).toBeChecked()
    expect(screen.getByRole('grid')).toHaveClass('is-showing-b')
  })

  it('follows a caller-controlled day without rendering its own switch', () => {
    const { rerender } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" mobileDay="B" readOnly {...callbacks} />)
    expect(screen.queryByRole('radiogroup', { name: 'Day shown' })).not.toBeInTheDocument()
    expect(screen.getByRole('grid')).toHaveClass('is-showing-b')
    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" mobileDay="A" readOnly {...callbacks} />)
    expect(screen.getByRole('grid')).toHaveClass('is-showing-a')
  })

  it('drives a controlled built-in switch when the caller handles day changes', async () => {
    const user = userEvent.setup()
    const onMobileDayChange = vi.fn()
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" mobileDay="A" onMobileDayChange={onMobileDayChange} {...callbacks} />)

    await user.click(screen.getByRole('radio', { name: 'B day' }))
    expect(onMobileDayChange).toHaveBeenCalledWith('B')
    expect(screen.getByRole('grid')).toHaveClass('is-showing-a')
  })
})

describe('TermSelector', () => {
  it('switches semesters as a labeled radio group', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TermSelector value="semester_1" onChange={onChange} label="Predicted schedule semester" />)

    const group = screen.getByRole('radiogroup', { name: 'Predicted schedule semester' })
    expect(within(group).getByRole('radio', { name: 'Semester 1' })).toBeChecked()
    await user.click(within(group).getByRole('radio', { name: 'Semester 2' }))
    expect(onChange).toHaveBeenCalledWith('semester_2')
    expect(group).toHaveClass('segmented', 'schedule-term-selector')
  })
})
