import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

    expect(styles).toContain('row-gap: 0')
    expect(styles).toContain('.schedule-row > .period-label, .schedule-row > .schedule-cell { border-top: 1px solid var(--border-strong); }')
    expect(styles).toContain('.filled-cell.is-continuation { border-top: 2px dashed #8dbbf0; }')

    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_1" {...callbacks} />)
    expect(screen.getAllByRole('row')).toHaveLength(9)
    rerender(<ScheduleGrid enrollments={[doublePeriod]} selectedTerm="semester_2" {...callbacks} />)
    expect(screen.getAllByRole('row')).toHaveLength(9)
  })
})
