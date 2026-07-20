import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import styles from '../../styles.css?raw'
import type { ScheduleEnrollment } from '../../lib/domain'
import { ScheduleGrid } from './ScheduleGrid'

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

const callbacks = {
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReplace: vi.fn(),
  onTermChange: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScheduleGrid borders', () => {
  it('renders an explicit boundary structure for every period and both day columns', () => {
    const { container, rerender } = render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="full_year" {...callbacks} />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(9)
    for (const [index, row] of rows.entries()) {
      expect(row).toHaveAttribute('data-period', String(index + 1))
      expect(within(row).getAllByRole('gridcell')).toHaveLength(2)
    }

    const periodSeven = container.querySelector('.schedule-row[data-period="7"]')
    const periodEight = container.querySelector('.schedule-row[data-period="8"]')
    expect(periodSeven?.querySelector('[data-day="A"]')).toHaveClass('filled-cell')
    expect(periodEight?.querySelector('[data-day="A"]')).toHaveAttribute('data-continuation', 'true')
    expect(periodSeven?.querySelector('[data-day="B"]')).toHaveClass('empty-cell')

    expect(styles).toMatch(/row-gap\s*:\s*0\s*;/)
    expect(styles).toMatch(/\.schedule-row\s*>\s*\.period-label\s*,\s*\.schedule-row\s*>\s*\.schedule-cell\s*\{[^}]*border-top\s*:\s*1px\s+solid\s+var\(--border-strong\)\s*;/)
    expect(styles).toMatch(/\.filled-cell\.is-multi-period\s*\{[^}]*box-shadow\s*:\s*inset\s+5px\s+0\s+0\s+var\(--focus\)\s*;[^}]*background\s*:\s*#f7faff\s*;/)
    expect(styles).toMatch(/\.filled-cell\.is-continuation\s*\{[^}]*border-top\s*:\s*2px\s+dashed\s+#8dbbf0\s*;/)

    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    expect(screen.getAllByRole('row')).toHaveLength(9)
    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_2" {...callbacks} />)
    expect(screen.getAllByRole('row')).toHaveLength(9)
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
    const { container } = render(<ScheduleGrid enrollments={[asymmetric]} selectedTerm="full_year" {...callbacks} />)

    expect(container.querySelector('[data-day="A"][data-period="4"]')).not.toHaveAttribute('data-continuation')
    expect(container.querySelector('[data-day="B"][data-period="3"]')).not.toHaveAttribute('data-continuation')
    expect(container.querySelector('[data-day="B"][data-period="4"]')).toHaveAttribute('data-continuation', 'true')
    expect(container.querySelector('[data-day="A"][data-period="4"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="3"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="4"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="3"]')).toHaveClass('empty-cell')
    expect(screen.getByText('B Day · P3 + P4')).toBeInTheDocument()
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
    const normal: ScheduleEnrollment = {
      ...doublePeriod,
      id: 'enrollment-normal',
      class_id: 'class-normal',
      class: {
        ...doublePeriod.class,
        id: 'class-normal',
        is_double_period: false,
        meeting_slots: [
          { day_type: 'A', period_number: 5 },
          { day_type: 'B', period_number: 5 },
        ],
      },
    }
    const { container } = render(<ScheduleGrid enrollments={[derivedDouble, normal]} selectedTerm="full_year" {...callbacks} />)

    expect(container.querySelector('[data-day="A"][data-period="2"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="3"]')).toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="A"][data-period="5"]')).not.toHaveClass('is-multi-period')
    expect(container.querySelector('[data-day="B"][data-period="5"]')).not.toHaveClass('is-multi-period')
  })

  it('keeps only one action menu open and closes it when clicking elsewhere', async () => {
    const user = userEvent.setup()
    render(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="full_year" {...callbacks} />)
    const triggers = screen.getAllByRole('button', { name: 'Actions for AP Physics 1&2' })

    await user.click(triggers[0])
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(triggers[1])
    expect(screen.getAllByRole('menu')).toHaveLength(1)

    await user.click(screen.getByRole('grid'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
