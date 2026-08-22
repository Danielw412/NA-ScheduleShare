import { describe, expect, it } from 'vitest'
import type { BellScheduleBlock, ScheduleEnrollment, SchoolDayContext } from './domain'
import { easternLocalTime, formatCountdown, resolveNextClassTiming } from './bellSchedule'

function enrollment(courseName: string, day: 'A' | 'B', period: number, term: ScheduleEnrollment['academic_term'] = 'full_year'): ScheduleEnrollment {
  return {
    id: `${courseName}-${day}-${period}-${term}`,
    class_id: `${courseName}-class`,
    student_id: 'student',
    academic_term: term,
    active: true,
    created_at: '',
    updated_at: '',
    meeting_slots: [{ day_type: day, period_number: period }],
    class: {
      id: `${courseName}-class`,
      course_name_id: `${courseName}-course`,
      course_name: courseName,
      teacher_last_name: 'Teacher',
      default_academic_term: term,
      is_double_period: false,
      meeting_slots: [{ day_type: day, period_number: period }],
    },
  }
}

function block(position: number, period: number | null, start: string, end: string, label = period ? `Period ${period}` : 'Activity Period'): BellScheduleBlock {
  return { position, kind: period === null ? 'non_class' : 'class', label, period_number: period, start_time: start, end_time: end }
}

function day(date: string, blocks: BellScheduleBlock[], options: Partial<SchoolDayContext> = {}): SchoolDayContext {
  return {
    date,
    campus: 'NASH',
    day_type: 'A',
    semester: 'semester_1',
    no_school: false,
    source: 'default',
    schedule: {
      id: 'schedule',
      schedule_key: 'regular',
      display_name: 'Regular',
      campus_scope: 'BOTH',
      warning_time: '07:24',
      is_builtin: true,
      archived_at: null,
      updated_at: '',
      blocks,
    },
    ...options,
  }
}

describe('resolveNextClassTiming', () => {
  it('treats the exact start as occupied and the exact end as the next interval', () => {
    const context = day('2026-08-24', [block(1, 1, '07:28', '08:08'), block(2, 2, '08:12', '08:52')])
    const enrollments = [enrollment('AP Psychology', 'A', 1), enrollment('Biology', 'A', 2)]
    const atStart = resolveNextClassTiming(easternLocalTime(context.date, '07:28'), [context], enrollments)
    expect(atStart).toMatchObject({ status: 'live', mode: 'current', courseName: 'AP Psychology' })
    expect(formatCountdown(atStart.remainingMs ?? 0)).toBe('40:00')
    const atEnd = resolveNextClassTiming(easternLocalTime(context.date, '08:08'), [context], enrollments)
    expect(atEnd).toMatchObject({ status: 'live', mode: 'next', courseName: 'Biology' })
    expect(formatCountdown(atEnd.remainingMs ?? 0)).toBe('4:00')
  })

  it('includes passing gaps and skips an empty period to the next occupied class', () => {
    const context = day('2026-08-24', [
      block(1, 1, '07:28', '08:08'),
      block(2, null, '08:08', '08:21', 'Homeroom'),
      block(3, 2, '08:25', '09:05'),
      block(4, 3, '09:09', '09:49'),
    ])
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '08:10'), [context], [enrollment('Chemistry', 'A', 3)])
    expect(timing).toMatchObject({ mode: 'next', courseName: 'Chemistry' })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '09:09').getTime())
    expect(timing.intervalStart?.getTime()).toBe(easternLocalTime(context.date, '08:08').getTime())
  })

  it('uses generic class bells when the day has no A/B assignment', () => {
    const context = day('2026-08-24', [block(1, 1, '07:28', '08:08'), block(2, 2, '08:12', '08:52')], { day_type: null })
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '07:30'), [context], [enrollment('AP Psychology', 'A', 2)])
    expect(timing).toMatchObject({ mode: 'next', courseName: null })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '08:12').getTime())
  })

  it('honors reordered early-dismissal periods instead of numeric period order', () => {
    const context = day('2026-08-24', [
      block(1, 4, '09:04', '09:32'),
      block(2, 8, '09:36', '10:04'),
      block(3, 9, '10:08', '10:36'),
      block(4, 5, '10:40', '11:09'),
    ])
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '09:33'), [context], [enrollment('AP Art', 'A', 8), enrollment('Calculus', 'A', 5)])
    expect(timing.courseName).toBe('AP Art')
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '09:36').getTime())
  })

  it('selects courses by A/B day and derived semester', () => {
    const context = day('2027-01-12', [block(1, 1, '07:28', '08:08')], { day_type: 'B', semester: 'semester_2' })
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '07:30'), [context], [
      enrollment('Semester One', 'B', 1, 'semester_1'),
      enrollment('Semester Two', 'B', 1, 'semester_2'),
      enrollment('Wrong Day', 'A', 1, 'semester_2'),
    ])
    expect(timing.courseName).toBe('Semester Two')
  })

  it('shows a future school date without a progress bar after dismissal or on a closed day', () => {
    const closed = day('2026-08-23', [], { no_school: true, schedule: null, day_type: null })
    const monday = day('2026-08-24', [block(1, 1, '07:28', '08:08')])
    const timing = resolveNextClassTiming(easternLocalTime('2026-08-23', '12:00'), [closed, monday], [enrollment('English', 'A', 1)])
    expect(timing).toMatchObject({ status: 'upcoming', progressPercent: null, targetDate: '2026-08-24' })
  })

  it('uses a strict two-hour threshold', () => {
    const context = day('2026-08-24', [block(1, 1, '10:00', '10:40')])
    expect(resolveNextClassTiming(easternLocalTime(context.date, '08:00'), [context], []).status).toBe('upcoming')
    expect(resolveNextClassTiming(new Date(easternLocalTime(context.date, '08:00').getTime() + 1000), [context], []).status).toBe('live')
  })

  it('returns no upcoming classes after the configured final day window', () => {
    const finalDay = day('2027-05-28', [block(1, 1, '07:28', '08:08')])
    expect(resolveNextClassTiming(easternLocalTime(finalDay.date, '15:00'), [finalDay], []).status).toBe('none')
  })

  it('constructs Eastern school times correctly on both sides of daylight saving time', () => {
    expect(easternLocalTime('2026-10-30', '07:28').toISOString()).toBe('2026-10-30T11:28:00.000Z')
    expect(easternLocalTime('2026-11-06', '07:28').toISOString()).toBe('2026-11-06T12:28:00.000Z')
  })
})
