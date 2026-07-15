import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseNameSearchResult } from '../lib/domain'
import { useCourseNameSearch, type CourseNameSearchExecutor } from './useCourseNameSearch'

const physics: CourseNameSearchResult = { id: 'course-physics', course_name: 'AP Physics 1&2', score: 100 }

afterEach(() => vi.useRealTimers())

describe('useCourseNameSearch', () => {
  it('debounces partial course-name searches and returns similar names', async () => {
    vi.useFakeTimers()
    const search = vi.fn<CourseNameSearchExecutor>().mockResolvedValue([physics])
    const { result } = renderHook(() => useCourseNameSearch('ap   phys', { debounceMs: 20, search }))

    await act(async () => { await vi.advanceTimersByTimeAsync(20) })

    expect(search).toHaveBeenCalledWith('ap   phys', expect.any(AbortSignal))
    expect(result.current.results).toEqual([physics])
    expect(result.current.loading).toBe(false)
  })

  it('does not search while the creation flow is disabled', () => {
    const search = vi.fn<CourseNameSearchExecutor>().mockResolvedValue([])
    const { result } = renderHook(() => useCourseNameSearch('', { enabled: false, search }))
    expect(search).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })
})
