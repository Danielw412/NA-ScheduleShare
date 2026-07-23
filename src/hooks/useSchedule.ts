import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { demoEnrollments } from '../lib/demo-data'
import type { AcademicTerm, ClassDefinition, MeetingSlot, ScheduleEnrollment } from '../lib/domain'
import { fetchSchedule } from '../lib/supabase/data'

export function useSchedule(studentId?: string) {
  const { user, isDemo } = useAuth()
  const ownerId = studentId ?? user?.id
  const [enrollments, setEnrollments] = useState<ScheduleEnrollment[]>(isDemo ? demoEnrollments : [])
  const [loading, setLoading] = useState(Boolean(ownerId && !isDemo))
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!ownerId) {
      setEnrollments([])
      setLoading(false)
      setError(null)
      return
    }
    if (isDemo) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setEnrollments(await fetchSchedule(ownerId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the schedule.')
    } finally {
      setLoading(false)
    }
  }, [isDemo, ownerId])

  useEffect(() => {
    void reload()
  }, [reload])

  const addDemoEnrollment = useCallback((classDefinition: ClassDefinition, term: AcademicTerm, replacingEnrollmentId?: string) => {
    if (!ownerId) return
    const timestamp = new Date().toISOString()
    const nextEnrollment: ScheduleEnrollment = {
      id: crypto.randomUUID(),
      class_id: classDefinition.id,
      student_id: ownerId,
      academic_term: term,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
      meeting_slots: classDefinition.meeting_slots,
      class: classDefinition,
    }
    setEnrollments((current) => replacingEnrollmentId
      ? current.map((enrollment) => enrollment.id === replacingEnrollmentId
          ? { ...nextEnrollment, id: replacingEnrollmentId, created_at: enrollment.created_at }
          : enrollment)
      : [...current, nextEnrollment])
  }, [ownerId])

  const removeDemoEnrollment = useCallback((enrollmentId: string) => {
    setEnrollments((current) => current.filter((enrollment) => enrollment.id !== enrollmentId))
  }, [])

  const updateDemoSchedule = useCallback((enrollmentId: string, term: AcademicTerm, meetingSlots: MeetingSlot[]) => {
    setEnrollments((current) => current.map((enrollment) => enrollment.id === enrollmentId
      ? { ...enrollment, academic_term: term, meeting_slots: meetingSlots }
      : enrollment))
  }, [])

  return { enrollments, loading, error, reload, addDemoEnrollment, removeDemoEnrollment, updateDemoSchedule }
}
