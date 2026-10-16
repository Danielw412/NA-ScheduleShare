import { describe, expect, it } from 'vitest'
import type { MeetingSlot, ScheduleEnrollment } from '../../lib/domain'
import { changedEnrollmentIds, changedPeriods, scheduleChanges } from './scheduleChanges'

function enrollment(id: string, courseName: string, slots: MeetingSlot[], academicTerm: ScheduleEnrollment['academic_term'] = 'full_year'): ScheduleEnrollment {
  return {
    id: `enrollment-${id}`,
    class_id: `class-${id}`,
    student_id: 'student',
    academic_term: academicTerm,
    active: true,
    created_at: '',
    updated_at: '',
    meeting_slots: slots,
    class: {
      id: `class-${id}`,
      course_name_id: `course-${courseName}`,
      course_name: courseName,
      teacher_last_name: 'Teacher',
      default_academic_term: academicTerm,
      is_double_period: false,
      meeting_slots: slots,
    },
  }
}

const both = (period: number): MeetingSlot[] => [{ day_type: 'A', period_number: period }, { day_type: 'B', period_number: period }]

describe('scheduleChanges', () => {
  it('returns nothing when the schedules match', () => {
    const current = [enrollment('english', 'English', both(1)), enrollment('chem', 'Chemistry', both(2))]
    expect(scheduleChanges(current, current)).toEqual([])
  })

  it('groups a full-year A and B day swap into one change', () => {
    const english = enrollment('english', 'English', both(1))
    const literature = enrollment('lit', 'Literature', both(1))
    const chemistry = enrollment('chem', 'Chemistry', both(2))
    const changes = scheduleChanges([english, chemistry], [literature, chemistry])
    expect(changes).toHaveLength(1)
    expect(changes[0].from?.id).toBe(english.id)
    expect(changes[0].to?.id).toBe(literature.id)
    expect(changes[0].slots).toEqual(both(1))
    expect(changes[0].terms).toEqual(['semester_1', 'semester_2'])
    expect(changedPeriods(changes)).toEqual([1])
    expect([...changedEnrollmentIds(changes)]).toEqual([literature.id])
  })

  it('lists each period of a collateral move in period order', () => {
    const chemistry = enrollment('chem', 'Chemistry', both(2))
    const biology = enrollment('bio', 'Biology', both(4))
    const movedBiology = enrollment('bio-2', 'Biology', both(2))
    const movedChemistry = enrollment('chem-4', 'Chemistry', both(4))
    const changes = scheduleChanges([chemistry, biology], [movedChemistry, movedBiology])
    expect(changes.map((change) => [change.from?.class.course_name, change.to?.class.course_name])).toEqual([
      ['Chemistry', 'Biology'],
      ['Biology', 'Chemistry'],
    ])
    expect(changedPeriods(changes)).toEqual([2, 4])
  })

  it('keeps semester-only changes to the semester they happen in', () => {
    const art = enrollment('art', 'Art', both(5), 'semester_1')
    const health = enrollment('health', 'Health', both(5), 'semester_2')
    const music = enrollment('music', 'Music', both(5), 'semester_1')
    const changes = scheduleChanges([art, health], [music, health])
    expect(changes).toHaveLength(1)
    expect(changes[0].terms).toEqual(['semester_1'])
  })

  it('reports a period that becomes empty', () => {
    const english = enrollment('english', 'English', both(1))
    const changes = scheduleChanges([english], [])
    expect(changes[0].to).toBeNull()
    expect(changedEnrollmentIds(changes).size).toBe(0)
  })
})
