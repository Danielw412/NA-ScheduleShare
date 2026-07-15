import { act, renderHook } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClassSearchResult } from '../lib/domain'
import { useClassSearch, type ClassSearchExecutor } from './useClassSearch'

const chemistry: ClassSearchResult = {
  id: '20000000-0000-4000-8000-000000000002',
  class_name: 'Chemistry',
  teacher_name: 'Mr. Patel',
  default_academic_term: 'full_year',
  is_double_period: false,
  meeting_slots: [{ day_type: 'A', period_number: 2 }],
  score: 100,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useClassSearch', () => {
  it('does not duplicate the debounced request under Strict Mode', async () => {
    vi.useFakeTimers()
    const search = vi.fn<ClassSearchExecutor>().mockResolvedValue([])
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useClassSearch({ query: '' }, { debounceMs: 20, search }), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })

    expect(search).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
    expect(result.current.results).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('ignores a stale request that resolves after the latest search', async () => {
    vi.useFakeTimers()
    const resolvers = new Map<string, (results: ClassSearchResult[]) => void>()
    const search: ClassSearchExecutor = (input) => new Promise((resolve) => resolvers.set(input.query, resolve))
    const { result, rerender } = renderHook(({ query }) => useClassSearch({ query }, { debounceMs: 0, search }), {
      initialProps: { query: 'chem' },
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    rerender({ query: 'patel' })
    await act(async () => {
      await vi.runAllTimersAsync()
      resolvers.get('patel')?.([chemistry])
    })
    await act(async () => {
      resolvers.get('chem')?.([])
    })

    expect(result.current.results).toEqual([chemistry])
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('keeps failed requests distinct from an empty result', async () => {
    vi.useFakeTimers()
    const search: ClassSearchExecutor = async () => { throw { code: '42883', message: 'database detail' } }
    const { result } = renderHook(() => useClassSearch({ query: '' }, { debounceMs: 0, search }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.results).toEqual([])
    expect(result.current.error).toBe('Class search is temporarily unavailable. Please try again.')
    expect(result.current.loading).toBe(false)
  })
})
