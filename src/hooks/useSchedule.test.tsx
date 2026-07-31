import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleEnrollment } from '../lib/domain'
import { useSchedule } from './useSchedule'

const mocks = vi.hoisted(() => ({
  fetchSchedule: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../lib/supabase/data', () => ({ fetchSchedule: mocks.fetchSchedule }))

function enrollment(id: string, studentId: string): ScheduleEnrollment {
  const timestamp = '2026-07-30T12:00:00.000Z'
  return {
    id,
    class_id: `class-${id}`,
    student_id: studentId,
    academic_term: 'full_year',
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
    meeting_slots: [{ day_type: 'A', period_number: 1 }],
    class: {
      id: `class-${id}`,
      course_name_id: `course-${id}`,
      course_name: `Course ${id}`,
      teacher_last_name: 'Teacher',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 1 }],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ user: { id: 'viewer' }, isDemo: false })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useSchedule request isolation', () => {
  it('preserves demo changes when save flows reload the schedule', async () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'viewer' }, isDemo: true })
    const addedClass = enrollment('demo-added', 'viewer').class
    const { result } = renderHook(() => useSchedule())

    act(() => result.current.addDemoEnrollment(addedClass, 'full_year'))
    expect(result.current.enrollments.some((item) => item.class_id === addedClass.id)).toBe(true)

    await act(async () => { await result.current.reload() })
    expect(result.current.enrollments.some((item) => item.class_id === addedClass.id)).toBe(true)
  })

  it('ignores a stale schedule response after the requested student changes', async () => {
    const first = deferred<ScheduleEnrollment[]>()
    const second = deferred<ScheduleEnrollment[]>()
    mocks.fetchSchedule.mockImplementation((studentId: string) => studentId === 'student-a' ? first.promise : second.promise)

    const { result, rerender } = renderHook(
      ({ studentId }) => useSchedule(studentId),
      { initialProps: { studentId: 'student-a' } },
    )
    await waitFor(() => expect(mocks.fetchSchedule).toHaveBeenCalledWith('student-a'))

    rerender({ studentId: 'student-b' })
    await waitFor(() => expect(mocks.fetchSchedule).toHaveBeenCalledWith('student-b'))

    await act(async () => { second.resolve([enrollment('b', 'student-b')]); await second.promise })
    expect(result.current.enrollments.map((item) => item.student_id)).toEqual(['student-b'])

    await act(async () => { first.resolve([enrollment('a', 'student-a')]); await first.promise })
    expect(result.current.enrollments.map((item) => item.student_id)).toEqual(['student-b'])
  })

  it('clears previously loaded rows when the current schedule request fails', async () => {
    mocks.fetchSchedule.mockResolvedValueOnce([enrollment('a', 'student-a')])
    const failed = deferred<ScheduleEnrollment[]>()
    mocks.fetchSchedule.mockReturnValueOnce(failed.promise)

    const { result, rerender } = renderHook(
      ({ studentId }) => useSchedule(studentId),
      { initialProps: { studentId: 'student-a' } },
    )
    await waitFor(() => expect(result.current.enrollments).toHaveLength(1))

    rerender({ studentId: 'student-b' })
    await act(async () => { failed.reject(new Error('Access denied')); await failed.promise.catch(() => undefined) })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.enrollments).toEqual([])
    expect(result.current.error).toBe('Access denied')
  })

  it('retains a loaded schedule when a same-owner refresh fails', async () => {
    mocks.fetchSchedule.mockResolvedValueOnce([enrollment('a', 'student-a')])
    mocks.fetchSchedule.mockRejectedValueOnce(new Error('Temporary outage'))
    const { result } = renderHook(() => useSchedule('student-a'))
    await waitFor(() => expect(result.current.enrollments).toHaveLength(1))

    await act(async () => { await result.current.reload() })

    expect(result.current.enrollments.map((item) => item.student_id)).toEqual(['student-a'])
    expect(result.current.error).toBe('Temporary outage')
  })
})
