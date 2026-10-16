import { AlertCircle, ChevronLeft, ChevronRight, FileClock, RefreshCw, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ActivitySummary, EventLogCategory, EventLogRecord, SiteResetPreview } from '../../lib/domain'
import { superAdminAdd, superAdminDeleteLog, superAdminDeleteLogs, superAdminGetActivitySummary, superAdminGetSiteResetPreview, superAdminListLogsPage, superAdminResetSite } from '../../lib/supabase/data'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { useAdminDialogs } from './AdminDialogs'
import { AdminSectionHeading } from './AdminSectionHeading'
import { formatTimestamp, IdText, plural, sentenceCase, TableSkeleton } from './adminShared'

/* Super-administrator tools: audit logs and the protected site reset. */

/** Lets long snake_case identifiers wrap after underscores instead of mid-word. */
function breakableIdentifier(value: string) {
  const parts = value.split('_')
  return parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <>_<wbr /></> : null}</Fragment>)
}

/* ---------- Audit logs (super administrators) ---------- */

const emptyActivitySummary: ActivitySummary = {
  total_users: 0,
  daily_active_users: 0,
  weekly_active_users: 0,
  schedule_imports: 0,
  schedules_shared: 0,
  access_requests: 0,
}

const eventLogPageSizes = [25, 50, 100, 150, 250] as const

const logCategoryLabels: Record<EventLogCategory, string> = {
  security: 'Security',
  audit: 'Audit',
  import: 'Import',
  admin: 'Administrative',
}

export function eventLogPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  if (currentPage <= 4) [2, 3, 4, 5].forEach((page) => pages.add(page))
  if (currentPage >= totalPages - 3) [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page))
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((left, right) => left - right)
}

export function EventLogsPanel() {
  const { showToast } = useToast()
  const dialogs = useAdminDialogs()
  const [logs, setLogs] = useState<EventLogRecord[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof eventLogPageSizes)[number]>(50)
  const [summary, setSummary] = useState<ActivitySummary>(emptyActivitySummary)
  const [category, setCategory] = useState<EventLogCategory | ''>('')
  const [eventFilter, setEventFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFilters = Boolean(category || eventFilter || userFilter || targetFilter || resultFilter || createdFrom || createdTo)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextPage, nextSummary] = await Promise.all([
        superAdminListLogsPage({
          category,
          event: eventFilter,
          user: userFilter,
          target: targetFilter,
          result: resultFilter,
          createdFrom: createdFrom ? new Date(`${createdFrom}T00:00:00`).toISOString() : undefined,
          createdTo: createdTo ? new Date(`${createdTo}T23:59:59.999`).toISOString() : undefined,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        superAdminGetActivitySummary(),
      ])
      const lastPage = Math.max(1, Math.ceil(nextPage.total / pageSize))
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setLogs(nextPage.logs)
      setTotalLogs(nextPage.total)
      setSummary(nextSummary)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The logs could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [category, createdFrom, createdTo, eventFilter, page, pageSize, resultFilter, targetFilter, userFilter])

  useEffect(() => { void load() }, [load])

  function clearFilters() {
    setCategory('')
    setEventFilter('')
    setUserFilter('')
    setTargetFilter('')
    setResultFilter('')
    setCreatedFrom('')
    setCreatedTo('')
    setPage(1)
  }

  async function deleteLog(log: EventLogRecord) {
    const phrase = `DELETE LOG ${log.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
    const typed = await dialogs.prompt({
      title: 'Delete this log record?',
      description: <>This permanently deletes the <strong>{log.event_type}</strong> record from {formatTimestamp(log.created_at)}. It can’t be undone.</>,
      label: `Type ${phrase} to confirm`,
      match: phrase,
      monospace: true,
      submitLabel: 'Delete log',
      tone: 'danger',
    })
    if (typed !== phrase) return
    setError(null)
    try {
      await superAdminDeleteLog(log.id)
      showToast('The selected log was permanently deleted.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The log could not be deleted.')
    }
  }

  async function deleteFilteredLogs() {
    const phrase = 'DELETE FILTERED LOGS PERMANENTLY'
    const typed = await dialogs.prompt({
      title: `Delete all ${plural(totalLogs, 'matching log')}?`,
      description: 'This permanently deletes every record matching the current filters, including records beyond the current page. It can’t be undone.',
      label: `Type ${phrase} to confirm`,
      match: phrase,
      monospace: true,
      submitLabel: 'Delete matching logs',
      tone: 'danger',
    })
    if (typed !== phrase) return
    setError(null)
    try {
      const removed = await superAdminDeleteLogs({
        category,
        event: eventFilter,
        user: userFilter,
        target: targetFilter,
        result: resultFilter,
        createdFrom: createdFrom ? new Date(`${createdFrom}T00:00:00`).toISOString() : undefined,
        createdTo: createdTo ? new Date(`${createdTo}T23:59:59.999`).toISOString() : undefined,
      })
      showToast(`${removed} log${removed === 1 ? '' : 's'} permanently deleted.`)
      if (page === 1) await load()
      else setPage(1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The filtered logs could not be deleted.')
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize))
  const firstVisibleLog = totalLogs === 0 ? 0 : (page - 1) * pageSize + 1
  const lastVisibleLog = totalLogs === 0 ? 0 : Math.min((page - 1) * pageSize + logs.length, totalLogs)
  const numberedPages = eventLogPageNumbers(page, totalPages)
  const stats: Array<[string, number]> = [
    ['Accounts', summary.total_users],
    ['Active today', summary.daily_active_users],
    ['Active this week', summary.weekly_active_users],
    ['Imports', summary.schedule_imports],
    ['Shares', summary.schedules_shared],
    ['Access requests', summary.access_requests],
  ]

  return (
    <section className="admin-section" aria-labelledby="admin-logs-title">
      <AdminSectionHeading
        id="admin-logs-title"
        title="Security and audit logs"
        description="Permanent records with identifiers and useful change details. They never contain images, share tokens, signed URLs, full prompts, or full extracted schedules."
        actions={<button className="button button-secondary button-sm" type="button" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh</button>}
      />
      <dl className="admin-stats is-wide">
        {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="numeric">{Number(value).toLocaleString()}</dd></div>)}
      </dl>

      <form className="admin-log-filters" aria-label="Filter logs" onSubmit={(event) => { event.preventDefault(); if (page === 1) void load(); else setPage(1) }}>
        <div className="field">
          <label htmlFor="admin-log-category">Log</label>
          <select id="admin-log-category" value={category} onChange={(event) => { setCategory(event.target.value as EventLogCategory | ''); setPage(1) }}><option value="">All logs</option><option value="security">Security</option><option value="audit">Audit</option><option value="import">Import and debug</option><option value="admin">Administrative</option></select>
        </div>
        <div className="field">
          <label htmlFor="admin-log-event">Event</label>
          <input id="admin-log-event" className="admin-mono-input" placeholder="login_failed" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1) }} />
        </div>
        <div className="field">
          <label htmlFor="admin-log-user">User name or ID</label>
          <input id="admin-log-user" placeholder="Name or exact ID" value={userFilter} onChange={(event) => { setUserFilter(event.target.value); setPage(1) }} />
        </div>
        <div className="field">
          <label htmlFor="admin-log-target">Target</label>
          <input id="admin-log-target" placeholder="Type or ID" value={targetFilter} onChange={(event) => { setTargetFilter(event.target.value); setPage(1) }} />
        </div>
        <div className="field">
          <label htmlFor="admin-log-result">Result</label>
          <input id="admin-log-result" placeholder="succeeded" value={resultFilter} onChange={(event) => { setResultFilter(event.target.value); setPage(1) }} />
        </div>
        <div className="field">
          <label htmlFor="admin-log-from">From</label>
          <input id="admin-log-from" type="date" value={createdFrom} onChange={(event) => { setCreatedFrom(event.target.value); setPage(1) }} />
        </div>
        <div className="field">
          <label htmlFor="admin-log-to">Through</label>
          <input id="admin-log-to" type="date" value={createdTo} onChange={(event) => { setCreatedTo(event.target.value); setPage(1) }} />
        </div>
        <div className="form-actions admin-log-filter-actions">
          <button className="button button-primary" disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
          {hasFilters ? <button className="button button-ghost" type="button" onClick={clearFilters}>Clear filters</button> : null}
        </div>
      </form>

      {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}

      <div className="admin-results-bar">
        <span className="numeric" aria-live="polite">Showing {firstVisibleLog.toLocaleString()}–{lastVisibleLog.toLocaleString()} of {totalLogs.toLocaleString()} matching logs</span>
        <button className="button button-secondary button-sm button-danger-outline" type="button" disabled={loading || logs.length === 0} onClick={() => void deleteFilteredLogs()}><Trash2 aria-hidden="true" />Delete matching logs</button>
      </div>

      {loading && logs.length === 0 ? <TableSkeleton label="Loading logs" /> : !loading && logs.length === 0 && !error
        ? <EmptyState icon={FileClock} title="No logs match" action={hasFilters ? <button className="button button-secondary" type="button" onClick={clearFilters}>Clear filters</button> : undefined}>{hasFilters ? 'Try a wider date range or fewer filters.' : 'Logged events appear here.'}</EmptyState>
        : <div className="table-scroll admin-table-scroll">
          <table className="data-table admin-table admin-log-table" aria-busy={loading || undefined}>
            <thead>
              <tr><th scope="col">Event</th><th scope="col">User</th><th scope="col">Subject or target</th><th scope="col">Time</th><th scope="col">Details</th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="admin-cell-primary">
                    <span className="admin-stacked-text">
                      <code className="admin-code">{breakableIdentifier(log.event_type)}</code>
                      <span className="admin-log-tags">
                        <span className="badge badge-outline">{logCategoryLabels[log.log_category] ?? sentenceCase(log.log_category)}</span>
                        <small>{log.result ? sentenceCase(log.result) : 'No result'}</small>
                      </span>
                    </span>
                  </td>
                  <td data-label="User">
                    <span className="admin-stacked-text">
                      <span>{log.actor_name ?? 'System or signed out'}</span>
                      {log.actor_user_id ? <IdText value={log.actor_user_id} /> : null}
                    </span>
                  </td>
                  <td data-label="Subject or target">
                    <span className="admin-stacked-text">
                      <span>{log.subject_name ?? log.target_type ?? '—'}</span>
                      {log.subject_user_id ?? log.target_id ? <IdText value={String(log.subject_user_id ?? log.target_id)} /> : null}
                    </span>
                  </td>
                  <td data-label="Time" className="nowrap">{formatTimestamp(log.created_at)}</td>
                  <td data-label="Details">
                    <span className="admin-log-details">
                      <details className="admin-metadata">
                        <summary>Metadata</summary>
                        <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
                      </details>
                      <button className="icon-button" type="button" aria-label={`Delete ${log.event_type} log`} onClick={() => void deleteLog(log)}><Trash2 aria-hidden="true" /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}

      <nav className="admin-pagination" aria-label="Event log pages">
        <div className="admin-page-size">
          <label htmlFor="admin-log-page-size">Logs per page</label>
          <select id="admin-log-page-size" value={pageSize} disabled={loading} onChange={(event) => { setPageSize(Number(event.target.value) as (typeof eventLogPageSizes)[number]); setPage(1) }}>{eventLogPageSizes.map((size) => <option value={size} key={size}>{size}</option>)}</select>
        </div>
        <div className="admin-page-buttons">
          <button className="icon-button" type="button" aria-label="Previous page" disabled={loading || page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft aria-hidden="true" /></button>
          {numberedPages.map((pageNumber, index) => <Fragment key={pageNumber}>{index > 0 && pageNumber - numberedPages[index - 1] > 1 ? <span className="admin-page-gap" aria-hidden="true">…</span> : null}<button className={pageNumber === page ? 'admin-page-button is-current' : 'admin-page-button'} type="button" aria-label={`Page ${pageNumber}`} aria-current={pageNumber === page ? 'page' : undefined} disabled={loading} onClick={() => setPage(pageNumber)}>{pageNumber}</button></Fragment>)}
          <button className="icon-button" type="button" aria-label="Next page" disabled={loading || page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight aria-hidden="true" /></button>
        </div>
      </nav>
      {dialogs.dialog}
    </section>
  )
}

/* ---------- Protected tools (super administrators) ---------- */

const resetPhrase = 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES'

export function ProtectedToolsPanel() {
  const { showToast } = useToast()
  const dialogs = useAdminDialogs()
  const [preview, setPreview] = useState<SiteResetPreview | null>(null)
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

  const loadPreview = useCallback(async () => {
    try { setPreview(await superAdminGetSiteResetPreview()) }
    catch (caught) { setResetError(caught instanceof Error ? caught.message : 'The reset preview could not be loaded.') }
  }, [])

  useEffect(() => { void loadPreview() }, [loadPreview])

  async function addAccess(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setAccessError(null)
    try {
      await superAdminAdd(email)
      setEmail('')
      showToast('Protected access was granted to the existing account with that exact email.')
    } catch (caught) {
      setAccessError(caught instanceof Error ? caught.message : 'Protected access could not be granted.')
    } finally { setBusy(false) }
  }

  async function resetSite() {
    if (!acknowledged || confirmation !== resetPhrase) return
    const confirmed = await dialogs.confirm({
      title: 'Reset ScheduleShare now?',
      message: 'Every other account and all profile pictures, profile data, schedules, classes, access requests, reports, school-day assignments, and bell-sync history will be permanently removed. Your account returns to onboarding, while your admin permissions, the course-name catalog, bell definitions, and bell-sync configuration remain.',
      confirmLabel: 'Reset ScheduleShare',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true)
    setResetError(null)
    try {
      await superAdminResetSite(confirmation)
      window.location.assign(import.meta.env.BASE_URL)
    } catch (caught) {
      setResetError(caught instanceof Error ? caught.message : 'The website reset did not complete.')
      setBusy(false)
    }
  }

  return (
    <div className="admin-stack">
      <section className="admin-section admin-narrow" aria-labelledby="admin-protected-access-title">
        <AdminSectionHeading
          id="admin-protected-access-title"
          title="Protected access"
          description="Give super administrator tools to a trusted, existing administrator. This page never shows who already has access."
        />
        <form className="admin-inline-form" onSubmit={(event) => void addAccess(event)}>
          <div className="field">
            <label htmlFor="admin-protected-email">Exact account email</label>
            <div className="admin-inline-form-row">
              <input id="admin-protected-email" type="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} />
              <button className="button button-primary" disabled={busy || !email}>Grant access</button>
            </div>
          </div>
          {accessError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{accessError}</p> : null}
        </form>
      </section>

      <section className="admin-section admin-danger-zone" aria-labelledby="admin-reset-title">
        <AdminSectionHeading
          id="admin-reset-title"
          title="Reset for a new school year"
          description="Deletes every other account and all profile pictures, profile data, schedules, classes, access requests, reports, school-day assignments, bell-sync history, and temporary importer data. Your account returns to onboarding. Your admin permissions, the course-name catalog, bell definitions, bell and sync configuration, and the protected audit record stay."
        />
        <div className="admin-reset-counts">
          <h3>What will be deleted</h3>
          {preview
            ? <dl className="admin-stats">{Object.entries(preview).map(([label, value]) => <div key={label}><dt>{sentenceCase(label)}</dt><dd className="numeric">{Number(value).toLocaleString()}</dd></div>)}</dl>
            : <p className="empty-inline" role="status">Loading exact deletion counts…</p>}
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span><strong>I understand that this removes every other account and resets my profile.</strong><small>Your sign-in and admin permissions stay. Everyone else must create a new account.</small></span>
        </label>
        <div className="field">
          <label htmlFor="admin-reset-phrase">Type <code className="admin-code">{resetPhrase}</code></label>
          <input id="admin-reset-phrase" className="admin-mono-input" autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
        {resetError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{resetError}</p> : null}
        <div className="form-actions">
          <button className="button button-danger" type="button" disabled={busy || !acknowledged || confirmation !== resetPhrase} onClick={() => void resetSite()}>{busy ? 'Resetting…' : 'Permanently reset ScheduleShare'}</button>
        </div>
      </section>
      {dialogs.dialog}
    </div>
  )
}
