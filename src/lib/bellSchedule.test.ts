import { describe, expect, it } from 'vitest'
import type { BellScheduleBlock, ScheduleEnrollment, SchoolDayContext } from './domain'
import { blockMark, blockTitle, coursesAtBlock, easternLocalTime, formatCountdown, formatEasternDayLabel, formatEasternTimeRange, resolveBellNow, resolveNextClassTiming } from './bellSchedule'

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

  it('counts down to the end of a named block', () => {
    const context = day('2026-08-24', [
      block(1, 1, '07:28', '08:08'),
      block(2, null, '08:08', '08:21', 'Homeroom'),
      block(3, 2, '08:25', '09:05'),
      block(4, 3, '09:09', '09:49'),
    ])
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '08:10'), [context], [enrollment('Chemistry', 'A', 3)])
    expect(timing).toMatchObject({ mode: 'current', courseName: 'Homeroom' })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '08:21').getTime())
    expect(timing.intervalStart?.getTime()).toBe(easternLocalTime(context.date, '08:08').getTime())
  })

  it('includes passing gaps and skips an empty period to the next occupied class', () => {
    const context = day('2026-08-24', [
      block(1, 1, '07:28', '08:08'),
      block(2, null, '08:08', '08:21', 'Homeroom'),
      block(3, 2, '08:25', '09:05'),
      block(4, 3, '09:09', '09:49'),
    ])
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '08:22'), [context], [enrollment('Chemistry', 'A', 3)])
    expect(timing).toMatchObject({ mode: 'next', courseName: 'Chemistry' })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '09:09').getTime())
    expect(timing.intervalStart?.getTime()).toBe(easternLocalTime(context.date, '08:21').getTime())
  })

  it('uses the active class bell when the day has no A/B assignment', () => {
    const context = day('2026-08-24', [block(1, 1, '07:28', '08:08'), block(2, 2, '08:12', '08:52')], { day_type: null })
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '07:30'), [context], [enrollment('AP Psychology', 'A', 2)])
    expect(timing).toMatchObject({ mode: 'current', currentBlockKind: 'class', courseName: null })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '08:08').getTime())
  })

  it('counts down to the current period end when the A/B assignment is missing', () => {
    const context = day('2026-09-04', [
      block(1, 2, '08:25', '09:05'),
      block(2, 3, '09:09', '09:49'),
    ], { day_type: null })
    const timing = resolveNextClassTiming(easternLocalTime(context.date, '08:53'), [context], [])

    expect(timing).toMatchObject({
      status: 'live',
      mode: 'current',
      currentBlockKind: 'class',
      courseName: null,
    })
    expect(timing.targetAt?.getTime()).toBe(easternLocalTime(context.date, '09:05').getTime())
    expect(formatCountdown(timing.remainingMs ?? 0)).toBe('12:00')
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

describe('resolveBellNow', () => {
  const regular = [
    block(1, 1, '07:28', '08:08'),
    block(2, null, '08:08', '08:21', 'Homeroom'),
    block(3, 2, '08:25', '09:05'),
  ]

  it('reports the block in progress with its end time and progress', () => {
    const bell = resolveBellNow(easternLocalTime('2026-08-24', '07:48'), [day('2026-08-24', regular)])
    expect(bell.state).toBe('in_block')
    expect(bell.isToday).toBe(true)
    expect(bell.current?.period_number).toBe(1)
    expect(bell.next?.label).toBe('Homeroom')
    expect(bell.targetAt).toEqual(easternLocalTime('2026-08-24', '08:08'))
    expect(bell.remainingMs).toBe(20 * 60_000)
    expect(bell.progressPercent).toBe(50)
  })

  it('treats the gap between blocks as passing time toward the next bell', () => {
    const bell = resolveBellNow(easternLocalTime('2026-08-24', '08:23'), [day('2026-08-24', regular)])
    expect(bell.state).toBe('passing')
    expect(bell.current).toBeNull()
    expect(bell.next?.period_number).toBe(2)
    expect(bell.remainingMs).toBe(2 * 60_000)
    expect(bell.progressPercent).toBe(50)
  })

  it('counts toward the first bell before school without a progress bar', () => {
    const bell = resolveBellNow(easternLocalTime('2026-08-24', '07:00'), [day('2026-08-24', regular)])
    expect(bell.state).toBe('before_school')
    expect(bell.next?.period_number).toBe(1)
    expect(bell.progressPercent).toBeNull()
  })

  it('moves to the next school day after dismissal and on closed days', () => {
    const days = [
      day('2026-08-24', regular),
      day('2026-08-25', [], { no_school: true, schedule: null, day_type: null }),
      day('2026-08-26', regular, { day_type: 'B' }),
    ]
    const afterSchool = resolveBellNow(easternLocalTime('2026-08-24', '15:00'), days)
    expect(afterSchool.state).toBe('after_school')
    expect(afterSchool.isToday).toBe(false)
    expect(afterSchool.day?.date).toBe('2026-08-26')
    expect(afterSchool.targetAt).toEqual(easternLocalTime('2026-08-26', '07:28'))

    const closedDay = resolveBellNow(easternLocalTime('2026-08-25', '09:00'), days)
    expect(closedDay.state).toBe('no_school')
    expect(closedDay.day?.date).toBe('2026-08-26')
  })

  it('reports nothing when the calendar has no upcoming school days', () => {
    expect(resolveBellNow(easternLocalTime('2026-08-24', '09:00'), []).state).toBe('none')
    const finalDay = resolveBellNow(easternLocalTime('2026-08-24', '15:00'), [day('2026-08-24', regular)])
    expect(finalDay.state).toBe('after_school')
    expect(finalDay.isToday).toBe(true)
    expect(finalDay.targetAt).toBeNull()
  })

  it('names and marks blocks for display', () => {
    expect(blockTitle(regular[0])).toBe('Period 1')
    expect(blockMark(regular[0])).toBe('1')
    expect(blockTitle(regular[1])).toBe('Homeroom')
    expect(blockMark(regular[1])).toBe('H')
  })

  it('finds the student\'s courses for a block by A/B day and semester', () => {
    const today = day('2026-08-24', regular)
    const courses = coursesAtBlock(today, regular[0], [
      enrollment('AP Psychology', 'A', 1),
      enrollment('Chemistry', 'B', 1),
      enrollment('Spanish', 'A', 1, 'semester_2'),
    ])
    expect(courses.map((course) => course.class.course_name)).toEqual(['AP Psychology'])
    expect(coursesAtBlock(today, regular[1], [enrollment('AP Psychology', 'A', 1)])).toEqual([])
    expect(coursesAtBlock({ ...today, day_type: null }, regular[0], [enrollment('AP Psychology', 'A', 1)])).toEqual([])
  })

  it('formats Eastern time ranges and relative day labels', () => {
    expect(formatEasternTimeRange(easternLocalTime('2026-08-24', '09:09'), easternLocalTime('2026-08-24', '09:49')).replace(/\s/g, ' ')).toBe('9:09 – 9:49 AM')
    expect(formatEasternTimeRange(easternLocalTime('2026-08-24', '11:21'), easternLocalTime('2026-08-24', '12:01')).replace(/\s/g, ' ')).toBe('11:21 AM – 12:01 PM')
    const now = easternLocalTime('2026-08-24', '10:00')
    expect(formatEasternDayLabel('2026-08-24', now)).toBe('Today')
    expect(formatEasternDayLabel('2026-08-25', now)).toBe('Tomorrow')
    expect(formatEasternDayLabel('2026-08-27', now)).toBe('Thursday')
  })
})
