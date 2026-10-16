import { useCallback } from 'react'
import { useToast } from '../ui/Toast'

/* Helpers shared by the administration panels. */

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function formatTimestamp(value: string | null, empty = 'Never'): string {
  if (!value) return empty
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? empty : dateTimeFormatter.format(date)
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`
}

export function sentenceCase(value: string): string {
  const spaced = value.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}


export type AdminActionRunner = (name: string, args: Record<string, unknown>, success: string, options?: { onError?: (message: string) => void }) => Promise<boolean>

export function useCopyToClipboard() {
  const { showToast } = useToast()
  return useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${what} copied.`)
    } catch {
      showToast(`The ${what.toLowerCase()} couldn’t be copied. Select it and copy it instead.`, 'error')
    }
  }, [showToast])
}

export function TableSkeleton({ label }: { label: string }) {
  return <div className="admin-skeleton" role="status" aria-label={label}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
}

export function IdText({ value }: { value: string }) {
  return <small className="admin-id" title={value}>{value}</small>
}
