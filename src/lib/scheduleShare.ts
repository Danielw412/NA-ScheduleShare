import { supabase } from './supabase/client'
import type { AcademicTerm, DayType, ScheduleEnrollment } from './domain'

export const scheduleShareTitle = 'My A/B-Day Schedule | NA ScheduleShare'

const shareServiceBaseUrl = import.meta.env.VITE_SCHEDULE_SHARE_BASE_URL?.trim().replace(/\/$/, '')
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface PublicScheduleRow {
  day_type: DayType
  period_number: number
  course_name: string
  teacher_last_name: string
  academic_term: AcademicTerm
}

export interface PublicScheduleShare {
  available: boolean
  owner_name: string | null
  schedule: PublicScheduleRow[]
}

const unavailableShare: PublicScheduleShare = { available: false, owner_name: null, schedule: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePublicScheduleRow(value: unknown): PublicScheduleRow | null {
  if (!isRecord(value)) return null
  if (value.day_type !== 'A' && value.day_type !== 'B') return null
  if (!Number.isInteger(value.period_number) || Number(value.period_number) < 1 || Number(value.period_number) > 9) return null
  if (typeof value.course_name !== 'string' || value.course_name.trim().length === 0) return null
  if (typeof value.teacher_last_name !== 'string' || value.teacher_last_name.trim().length === 0) return null
  if (value.academic_term !== 'full_year' && value.academic_term !== 'semester_1' && value.academic_term !== 'semester_2') return null
  return {
    day_type: value.day_type,
    period_number: Number(value.period_number),
    course_name: value.course_name.trim().slice(0, 120),
    teacher_last_name: value.teacher_last_name.trim().slice(0, 120),
    academic_term: value.academic_term,
  }
}

export function parsePublicScheduleShare(value: unknown): PublicScheduleShare {
  if (!isRecord(value) || value.available !== true || !Array.isArray(value.schedule)) return unavailableShare
  return {
    available: true,
    owner_name: typeof value.owner_name === 'string' && value.owner_name.trim() ? value.owner_name.trim().slice(0, 120) : null,
    schedule: value.schedule.map(parsePublicScheduleRow).filter((row): row is PublicScheduleRow => row !== null),
  }
}

export function publicRowsToEnrollments(rows: PublicScheduleRow[]): ScheduleEnrollment[] {
  const grouped = new Map<string, PublicScheduleRow[]>()
  for (const row of rows) {
    const key = `${row.academic_term}\u0000${row.course_name}\u0000${row.teacher_last_name}`
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return [...grouped.values()].map((courseRows, index) => {
    const first = courseRows[0]
    const meetingSlots = [...new Map(courseRows.map((row) => [
      `${row.day_type}:${row.period_number}`,
      { day_type: row.day_type, period_number: row.period_number },
    ])).values()].sort((left, right) => left.day_type.localeCompare(right.day_type) || left.period_number - right.period_number)
    const syntheticId = `shared-course-${index + 1}`
    return {
      id: syntheticId,
      class_id: syntheticId,
      student_id: 'shared-schedule',
      academic_term: first.academic_term,
      active: true,
      created_at: '',
      updated_at: '',
      class: {
        id: syntheticId,
        course_name_id: syntheticId,
        course_name: first.course_name,
        teacher_last_name: first.teacher_last_name,
        default_academic_term: first.academic_term,
        is_double_period: false,
        meeting_slots: meetingSlots,
      },
    }
  })
}

export async function fetchPublicScheduleShare(token: string): Promise<PublicScheduleShare> {
  if (!tokenPattern.test(token) || !supabase) return unavailableShare
  const { data, error } = await supabase.rpc('get_public_schedule_share', { p_token: token })
  if (error) throw error
  return parsePublicScheduleShare(data)
}

export async function createScheduleShareUrl(): Promise<string> {
  if (!supabase) throw new Error('Sign in before sharing a schedule.')
  if (!shareServiceBaseUrl) throw new Error('Schedule sharing is not configured yet.')

  const { data, error } = await supabase.rpc('get_or_create_schedule_share')
  if (error) throw error

  const token = typeof data === 'string' ? data : ''
  if (!tokenPattern.test(token)) throw new Error('Schedule sharing returned an invalid link.')
  return `${shareServiceBaseUrl}/share/${encodeURIComponent(token)}`
}
