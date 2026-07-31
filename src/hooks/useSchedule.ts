import { useCallback, useEffect, useRef, useState } from 'react'
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
  const latestRequest = useRef(0)
  const loadedOwner = useRef<string | undefined>(isDemo ? ownerId : undefined)

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current
    if (!ownerId) {
      loadedOwner.current = undefined
      setEnrollments([])
      setLoading(false)
      setError(null)
      return
    }
    if (isDemo) {
      loadedOwner.current = ownerId
      setLoading(false)
      setError(null)
      return
    }
    const ownerChanged = loadedOwner.current !== ownerId
    if (ownerChanged) {
      loadedOwner.current = undefined
      setEnrollments([])
    }
    setLoading(true)
    setError(null)
    try {
      const nextEnrollments = await fetchSchedule(ownerId)
      if (requestId === latestRequest.current) {
        loadedOwner.current = ownerId
        setEnrollments(nextEnrollments)
      }
    } catch (caught) {
      if (requestId === latestRequest.current) {
        setError(caught instanceof Error ? caught.message : 'Unable to load the schedule.')
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [isDemo, ownerId])

  useEffect(() => {
    void reload()
    return () => { latestRequest.current += 1 }
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
