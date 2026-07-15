import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { demoEnrollments, demoHistory } from '../lib/demo-data'
import type { AcademicTerm, ClassDefinition, HistoryRecord, ScheduleEnrollment } from '../lib/domain'
import { fetchHistory, fetchSchedule } from '../lib/supabase/data'

export function useSchedule(studentId?: string) {
  const { user, isDemo } = useAuth()
  const ownerId = studentId ?? user?.id
  const [enrollments, setEnrollments] = useState<ScheduleEnrollment[]>(isDemo ? demoEnrollments : [])
  const [history, setHistory] = useState<HistoryRecord[]>(isDemo ? demoHistory : [])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!ownerId) return
    if (isDemo) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextEnrollments, nextHistory] = await Promise.all([fetchSchedule(ownerId), fetchHistory(ownerId)])
      setEnrollments(nextEnrollments)
      setHistory(nextHistory)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the schedule.')
    } finally {
      setLoading(false)
    }
  }, [isDemo, ownerId])

  useEffect(() => {
    void reload()
  }, [reload])

  const addDemoEnrollment = useCallback((classDefinition: ClassDefinition, term: AcademicTerm) => {
    if (!ownerId) return
    const timestamp = new Date().toISOString()
    setEnrollments((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        class_id: classDefinition.id,
        student_id: ownerId,
        academic_term: term,
        active: true,
        created_at: timestamp,
        updated_at: timestamp,
        class: classDefinition,
      },
    ])
    setHistory((current) => [{
      id: crypto.randomUUID(),
      action: 'class_added',
      previous_value: null,
      new_value: { class_id: classDefinition.id, class_name: classDefinition.class_name },
      changed_by: ownerId,
      created_at: timestamp,
    }, ...current])
  }, [ownerId])

  const removeDemoEnrollment = useCallback((enrollmentId: string) => {
    setEnrollments((current) => current.filter((enrollment) => enrollment.id !== enrollmentId))
  }, [])

  const updateDemoTerm = useCallback((enrollmentId: string, term: AcademicTerm) => {
    setEnrollments((current) => current.map((enrollment) => enrollment.id === enrollmentId ? { ...enrollment, academic_term: term } : enrollment))
  }, [])

  return { enrollments, history, loading, error, reload, addDemoEnrollment, removeDemoEnrollment, updateDemoTerm }
}
