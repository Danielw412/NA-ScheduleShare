import { describe, expect, it } from 'vitest'
import { parsePublicScheduleShare, publicRowsToEnrollments } from './scheduleShare'

describe('public schedule share data', () => {
  it('accepts safe period 9 rows and discards private or malformed fields', () => {
    const share = parsePublicScheduleShare({
      available: true,
      schedule: [
        { day_type: 'A', period_number: 9, course_name: ' Robotics ', teacher_last_name: ' Lovelace ', academic_term: 'semester_1', teacher: 'Private' },
        { day_type: 'B', period_number: 10, course_name: 'Invalid', academic_term: 'semester_1' },
      ],
      email: 'private@example.com',
      owner_id: 'private-id',
    })

    expect(share).toEqual({
      available: true,
      schedule: [{ day_type: 'A', period_number: 9, course_name: 'Robotics', teacher_last_name: 'Lovelace', academic_term: 'semester_1' }],
    })
    expect(JSON.stringify(share)).not.toContain('private')
  })

  it('groups safe rows into read-only schedule enrollments without real IDs', () => {
    const enrollments = publicRowsToEnrollments([
      { day_type: 'A', period_number: 1, course_name: 'Biology', teacher_last_name: 'Green', academic_term: 'full_year' },
      { day_type: 'B', period_number: 1, course_name: 'Biology', teacher_last_name: 'Green', academic_term: 'full_year' },
    ])

    expect(enrollments).toHaveLength(1)
    expect(enrollments[0].class.course_name).toBe('Biology')
    expect(enrollments[0].class.teacher_last_name).toBe('Green')
    expect(enrollments[0].class.meeting_slots).toEqual([
      { day_type: 'A', period_number: 1 },
      { day_type: 'B', period_number: 1 },
    ])
    expect(enrollments[0].student_id).toBe('shared-schedule')
  })
})
