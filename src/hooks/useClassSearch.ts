import { useEffect, useRef, useState } from 'react'
import type { ClassSearchResult } from '../lib/domain'
import { searchClasses, type ClassSearchInput } from '../lib/supabase/data'

export type ClassSearchExecutor = (input: ClassSearchInput, signal?: AbortSignal) => Promise<ClassSearchResult[]>

interface UseClassSearchOptions {
  debounceMs?: number
  enabled?: boolean
  search?: ClassSearchExecutor
}

export function useClassSearch(input: ClassSearchInput, options: UseClassSearchOptions = {}) {
  const { debounceMs = 220, enabled = true, search = searchClasses } = options
  const [results, setResults] = useState<ClassSearchResult[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  useEffect(() => {
    const requestId = ++latestRequest.current
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const timer = window.setTimeout(() => {
      void search(input, controller.signal).then((nextResults) => {
        if (requestId !== latestRequest.current || controller.signal.aborted) return
        setResults(nextResults)
      }).catch((caught: unknown) => {
        if (requestId !== latestRequest.current || controller.signal.aborted) return
        setResults([])
        setError(caught instanceof Error ? caught.message : 'Class search is temporarily unavailable. Please try again.')
      }).finally(() => {
        if (requestId === latestRequest.current && !controller.signal.aborted) setLoading(false)
      })
    }, debounceMs)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [debounceMs, enabled, input.dayType, input.period, input.query, search])

  return { error, loading, results }
}
