import { useEffect, useRef, useState } from 'react'
import type { CourseNameSearchResult } from '../lib/domain'
import { searchCourseNames } from '../lib/supabase/data'

export type CourseNameSearchExecutor = (query: string, signal?: AbortSignal) => Promise<CourseNameSearchResult[]>

export function useCourseNameSearch(
  query: string,
  options: { enabled?: boolean; debounceMs?: number; search?: CourseNameSearchExecutor } = {},
) {
  const { enabled = true, debounceMs = 180, search = searchCourseNames } = options
  const [results, setResults] = useState<CourseNameSearchResult[]>([])
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
      void search(query, controller.signal).then((nextResults) => {
        if (requestId === latestRequest.current && !controller.signal.aborted) setResults(nextResults)
      }).catch((caught: unknown) => {
        if (requestId !== latestRequest.current || controller.signal.aborted) return
        setResults([])
        setError(caught instanceof Error ? caught.message : 'Course-name search is temporarily unavailable.')
      }).finally(() => {
        if (requestId === latestRequest.current && !controller.signal.aborted) setLoading(false)
      })
    }, debounceMs)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [debounceMs, enabled, query, search])

  return { error, loading, results }
}
