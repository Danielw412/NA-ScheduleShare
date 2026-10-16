import { AlertTriangle, Bug, CircleCheck, EyeOff, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { AppIssueDetail, AppIssueEvent, AppIssueStatus, AppIssueSummary } from '../../lib/domain'
import {
  adminDeleteAppIssue,
  adminFindAppIssueByReference,
  adminGetAppIssue,
  adminGetAppIssueSettings,
  adminListAppIssues,
  adminSetAppIssueIngest,
  adminUpdateAppIssueStatus,
} from '../../lib/supabase/data'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useToast } from '../ui/Toast'

type StatusFilter = AppIssueStatus | 'all'
const PAGE_SIZE = 25

const relativeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function relativeTime(value: string, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86_400], ['hour', 3_600], ['minute', 60]]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormatter.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

const sourceLabels: Record<AppIssueSummary['source'], string> = {
  web: 'Website',
  edge_function: 'Edge Function',
  worker: 'Share worker',
  schedule_engine: 'Schedule Engine',
}

function LevelBadge({ level }: { level: AppIssueSummary['level'] }) {
  if (level === 'fatal' || level === 'error') return <span className="badge badge-danger">{level === 'fatal' ? 'Fatal' : 'Error'}</span>
  return <span className="badge">Warning</span>
}

const demoIssues: AppIssueDetail[] = [
  {
    id: 'demo-issue-1', fingerprint: 'web-3f9a1c07d2e4b8', source: 'web', level: 'error',
    title: "TypeError: Cannot read properties of undefined (reading 'map')", culprit: 'renderRows (assets/ClassesPage.js)',
    status: 'open', event_count: 14, user_count: 6, first_seen_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    last_seen_at: new Date(Date.now() - 12 * 60_000).toISOString(), first_release: '4aa051f', last_release: 'b6f142c', environment: 'production', regressed_at: null,
    events: [{
      event_id: '8f3a2c1d9b7e4f60a1b2c3d4e5f60718', level: 'error', message: "TypeError: Cannot read properties of undefined (reading 'map')", exception_type: 'TypeError', user_id: null,
      stacktrace: [
        { function: 'renderRows', filename: 'assets/ClassesPage.js', lineno: 1, colno: 4812, in_app: true },
        { function: 'ClassesPage', filename: 'assets/ClassesPage.js', lineno: 1, colno: 9120, in_app: true },
        { function: 'renderWithHooks', filename: 'assets/index.js', lineno: 8, colno: 2231, in_app: false },
      ],
      breadcrumbs: [
        { timestamp: Date.now() - 20_000, category: 'navigation', message: '/ → /classes', level: 'info' },
        { timestamp: Date.now() - 18_000, category: 'http', message: 'POST /rest/v1/rpc/search_classes', level: 'info', data: { status: 200, duration_ms: 182 } },
        { timestamp: Date.now() - 2_000, category: 'navigation', message: '/classes → /classes/:id', level: 'info' },
      ],
      tags: { boundary: 'route' },
      context: { route: '/classes/:id', release: 'b6f142c', environment: 'production', viewport: '390x844' },
      created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    }],
  },
  {
    id: 'demo-issue-2', fingerprint: 'web-http-0a7c5e2f9d1b33', source: 'web', level: 'warning',
    title: 'Supabase /rest/v1/rpc/get_my_bell_schedule_window responded with 503', culprit: '/', status: 'open',
    event_count: 3, user_count: 3, first_seen_at: new Date(Date.now() - 86_400_000).toISOString(), last_seen_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    first_release: 'b6f142c', last_release: 'b6f142c', environment: 'production', regressed_at: null, events: [],
  },
]

/** Administrator view of the first-party issue store. See docs/observability.md. */
export function IssuesPanel({ isDemo }: { isDemo: boolean }) {
  const { showToast } = useToast()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [issues, setIssues] = useState<AppIssueSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [ingestEnabled, setIngestEnabled] = useState<boolean | null>(null)

  const requestVersion = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeadingAfterClose = useRef(false)

  // After resolve/ignore/delete the issue's row may leave the list, so focus
  // moves to the panel heading once the dialog has closed (this effect runs
  // after the dialog's own focus restore).
  useEffect(() => {
    if (selectedId !== null || !focusHeadingAfterClose.current) return
    focusHeadingAfterClose.current = false
    headingRef.current?.focus()
  }, [selectedId])

  const load = useCallback(async (offset = 0) => {
    // A slow "Show more" from a previous filter must not land in the new list.
    const version = offset === 0 ? ++requestVersion.current : requestVersion.current
    setLoading(true)
    setError(null)
    try {
      if (isDemo) {
        const filtered = demoIssues.filter((issue) => (status === 'all' || issue.status === status) && (!appliedSearch || issue.title.toLowerCase().includes(appliedSearch.toLowerCase())))
        setIssues(filtered)
        setTotal(filtered.length)
        return
      }
      const page = await adminListAppIssues({ status, search: appliedSearch, limit: PAGE_SIZE, offset })
      if (version !== requestVersion.current) return
      setIssues((current) => offset === 0 ? page.issues : [...current, ...page.issues])
      setTotal(page.total)
    } catch (caught) {
      if (version === requestVersion.current) setError(caught instanceof Error ? caught.message : 'Issues could not be loaded.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [appliedSearch, isDemo, status])

  useEffect(() => { void load(0) }, [load])

  useEffect(() => {
    if (isDemo) {
      setIngestEnabled(true)
      return
    }
    void adminGetAppIssueSettings().then((settings) => setIngestEnabled(settings.ingest_enabled)).catch(() => setIngestEnabled(null))
  }, [isDemo])

  async function toggleIngest(enabled: boolean) {
    const previous = ingestEnabled
    setIngestEnabled(enabled)
    try {
      if (!isDemo) await adminSetAppIssueIngest(enabled)
      showToast(enabled ? 'New error reports are being accepted.' : 'New error reports are paused.')
    } catch (caught) {
      setIngestEnabled(previous)
      showToast(caught instanceof Error ? caught.message : 'The setting could not be saved.', 'error')
    }
  }

  async function findReference(event: FormEvent) {
    event.preventDefault()
    setReferenceError(null)
    const value = reference.trim().toLowerCase()
    if (!/^[0-9a-f]{8,32}$/.test(value)) {
      setReferenceError('Enter the 8-character error reference from the student’s screen.')
      return
    }
    try {
      const issueId = isDemo ? demoIssues.find((issue) => issue.events.some((item) => item.event_id.startsWith(value)))?.id ?? null : await adminFindAppIssueByReference(value)
      if (issueId) setSelectedId(issueId)
      else setReferenceError('No issue matches that reference. Reports are kept for 30 days.')
    } catch (caught) {
      setReferenceError(caught instanceof Error ? caught.message : 'The reference could not be looked up.')
    }
  }

  return (
    <section className="admin-section issues-panel" aria-labelledby="issues-panel-title">
      <div className="section-header">
        <div>
          <h2 id="issues-panel-title" ref={headingRef} tabIndex={-1}>Issues</h2>
          <p>Errors reported by the website and servers, grouped by cause. Reports include an account id at most, never names, emails, or schedules.</p>
        </div>
        {ingestEnabled !== null ? (
          <label className="issues-ingest">
            <input type="checkbox" checked={ingestEnabled} onChange={(event) => void toggleIngest(event.target.checked)} />
            <span>Accept new reports</span>
          </label>
        ) : null}
      </div>

      <div className="issues-toolbar">
        <SegmentedControl
          label="Issue status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'ignored', label: 'Ignored' }, { value: 'all', label: 'All' }]}
        />
        <form className="issues-search" role="search" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search) }}>
          <div className="search-input">
            <Search aria-hidden="true" />
            <input type="search" aria-label="Search issues" placeholder="Search by message or file" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </form>
        <form className="issues-reference" onSubmit={(event) => void findReference(event)}>
          <input aria-label="Error reference" placeholder="Error reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={32} aria-invalid={referenceError ? true : undefined} aria-describedby={referenceError ? 'issues-reference-error' : undefined} />
          <button className="button button-secondary" type="submit">Find</button>
        </form>
      </div>
      {referenceError ? <p className="form-error" id="issues-reference-error" role="alert">{referenceError}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {!loading && issues.length === 0 && !error
        ? <EmptyState icon={status === 'open' ? CircleCheck : Bug} title={status === 'open' ? 'No open issues' : 'Nothing here'}>{status === 'open' ? 'New errors appear here as soon as they are reported.' : 'Issues you resolve or ignore are listed here.'}</EmptyState>
        : (
          <ul className="list issues-list" aria-busy={loading || undefined}>
            {issues.map((issue) => (
              <li key={issue.id}>
                <button className="list-row issues-row" type="button" onClick={() => setSelectedId(issue.id)}>
                  <span className="issues-row-main">
                    <span className="issues-row-badges">
                      <LevelBadge level={issue.level} />
                      {issue.regressed_at && issue.status === 'open' ? <span className="badge badge-outline">Regressed</span> : null}
                      <span className="issues-row-source">{sourceLabels[issue.source]}</span>
                    </span>
                    <strong>{issue.title}</strong>
                    {issue.culprit ? <small>{issue.culprit}</small> : null}
                  </span>
                  <span className="issues-row-stats numeric">
                    <span><strong>{issue.event_count}</strong> {issue.event_count === 1 ? 'event' : 'events'}</span>
                    <span><strong>{issue.user_count}</strong> {issue.user_count === 1 ? 'account' : 'accounts'}</span>
                    <span title={new Date(issue.last_seen_at).toLocaleString()}>{relativeTime(issue.last_seen_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {issues.length < total ? <button className="button button-secondary" type="button" disabled={loading} onClick={() => void load(issues.length)}>{loading ? 'Loading…' : 'Show more issues'}</button> : null}

      {selectedId ? (
        <IssueDetailDialog
          issueId={selectedId}
          isDemo={isDemo}
          returnFocusRef={headingRef}
          onClose={() => setSelectedId(null)}
          onChanged={(message) => {
            showToast(message)
            setSelectedId(null)
            void load(0)
            focusHeadingAfterClose.current = true
          }}
        />
      ) : null}
    </section>
  )
}

function IssueDetailDialog({ issueId, isDemo, onClose, onChanged, returnFocusRef }: { issueId: string; isDemo: boolean; onClose: () => void; onChanged: (message: string) => void; returnFocusRef: RefObject<HTMLHeadingElement | null> }) {
  const [issue, setIssue] = useState<AppIssueDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [eventIndex, setEventIndex] = useState(0)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    let active = true
    setIssue(null)
    setError(null)
    const request = isDemo ? Promise.resolve(demoIssues.find((item) => item.id === issueId) ?? null) : adminGetAppIssue(issueId)
    void request
      .then((value) => {
        if (!active) return
        if (value) setIssue(value)
        else setError('This issue no longer exists.')
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'The issue could not be loaded.') })
    return () => { active = false }
  }, [isDemo, issueId])

  async function changeStatus(next: AppIssueStatus) {
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateAppIssueStatus(issueId, next)
      onChanged(next === 'resolved' ? 'Issue resolved. It reopens if it happens again.' : next === 'ignored' ? 'Issue ignored.' : 'Issue reopened.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The issue could not be updated.')
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await adminDeleteAppIssue(issueId)
      onChanged('Issue deleted.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The issue could not be deleted.')
      setBusy(false)
    }
  }

  const event = issue?.events[eventIndex] ?? null
  const footer = issue ? (
    confirmingDelete ? (
      <>
        <span className="issues-confirm">Delete this issue and its reports?</span>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>Keep issue</button>
        <button className="button button-danger" type="button" disabled={busy} onClick={() => void remove()}><Trash2 aria-hidden="true" />Delete issue</button>
      </>
    ) : (
      <>
        <button className="button button-ghost button-danger-outline issues-delete" type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}><Trash2 aria-hidden="true" />Delete</button>
        {issue.status !== 'ignored' ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void changeStatus('ignored')}><EyeOff aria-hidden="true" />Ignore</button> : null}
        {issue.status === 'open'
          ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void changeStatus('resolved')}><CircleCheck aria-hidden="true" />Resolve</button>
          : <button className="button button-primary" type="button" disabled={busy} onClick={() => void changeStatus('open')}><RotateCcw aria-hidden="true" />Reopen</button>}
      </>
    )
  ) : null

  return (
    <Dialog title={issue?.title ?? 'Issue'} description={issue?.culprit ?? undefined} onClose={onClose} size="wide" footer={footer} closeLabel="Close issue" returnFocusRef={returnFocusRef} role={confirmingDelete ? 'alertdialog' : 'dialog'}>
      {error ? <p className="form-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {!issue && !error ? <div className="route-loading" role="status"><span className="spinner" aria-hidden="true" /><p>Loading issue…</p></div> : null}
      {issue ? (
        <div className="issues-detail">
          <dl className="facts">
            <dt>Status</dt><dd>{issue.status === 'open' ? (issue.regressed_at ? 'Open, regressed' : 'Open') : issue.status === 'resolved' ? 'Resolved' : 'Ignored'}</dd>
            <dt>Source</dt><dd>{sourceLabels[issue.source]}</dd>
            <dt>Events</dt><dd className="numeric">{issue.event_count}</dd>
            <dt>Accounts affected</dt><dd className="numeric">{issue.user_count}</dd>
            <dt>First seen</dt><dd>{dateTimeFormatter.format(new Date(issue.first_seen_at))}{issue.first_release ? `, release ${issue.first_release}` : ''}</dd>
            <dt>Last seen</dt><dd>{dateTimeFormatter.format(new Date(issue.last_seen_at))}{issue.last_release ? `, release ${issue.last_release}` : ''}</dd>
            <dt>Environment</dt><dd>{issue.environment ?? 'Unknown'}</dd>
            <dt>Fingerprint</dt><dd><code>{issue.fingerprint}</code></dd>
          </dl>

          {issue.events.length === 0 ? <p className="muted">No sample reports are stored for this issue. Samples are kept for 30 days.</p> : null}
          {issue.events.length > 1 ? (
            <label className="field issues-event-picker">
              <span className="field-label">Report</span>
              <select value={eventIndex} onChange={(change) => setEventIndex(Number(change.target.value))}>
                {issue.events.map((item, index) => <option key={item.event_id} value={index}>{dateTimeFormatter.format(new Date(item.created_at))}, reference {item.event_id.slice(0, 8).toUpperCase()}</option>)}
              </select>
            </label>
          ) : null}
          {event ? <IssueEventDetail event={event} /> : null}
        </div>
      ) : null}
    </Dialog>
  )
}

function IssueEventDetail({ event }: { event: AppIssueEvent }) {
  const extraEntries = useMemo(() => {
    const extra = event.context.extra
    return extra && typeof extra === 'object' && !Array.isArray(extra) ? Object.entries(extra as Record<string, unknown>) : []
  }, [event.context.extra])
  const contextEntries = useMemo(
    () => Object.entries(event.context).filter(([key, value]) => key !== 'extra' && value !== null && value !== undefined && value !== ''),
    [event.context],
  )
  return (
    <div className="issues-event">
      <p className="issues-event-reference">Reference <strong className="numeric">{event.event_id.slice(0, 8).toUpperCase()}</strong>{event.user_id ? <span>Account {event.user_id}</span> : <span title="Account ids are shown to super administrators only">Account not shown</span>}</p>
      <p className="issues-event-message">{event.message}</p>

      {event.stacktrace.length > 0 ? (
        <section aria-label="Stack trace">
          <h3>Stack trace</h3>
          <ol className="issues-stack">
            {event.stacktrace.map((frame, index) => (
              <li key={index} className={frame.in_app === false ? 'is-library' : undefined}>
                <code>{frame.function ?? '<anonymous>'}{frame.in_app === false ? <span className="issues-frame-kind"> library</span> : null}</code>
                <span>{frame.filename ?? 'unknown file'}{frame.lineno ? `:${frame.lineno}` : ''}{frame.colno ? `:${frame.colno}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {event.breadcrumbs.length > 0 ? (
        <section aria-label="What happened before">
          <h3>What happened before</h3>
          <ol className="issues-breadcrumbs">
            {event.breadcrumbs.map((crumb, index) => (
              <li key={index} className={crumb.level === 'error' || crumb.level === 'warning' ? `is-${crumb.level}` : undefined}>
                <span className="issues-crumb-category">{crumb.category}{crumb.level === 'error' || crumb.level === 'warning' ? <strong> {crumb.level === 'error' ? 'error' : 'warning'}</strong> : null}</span>
                <span className="issues-crumb-message">{crumb.message}{crumb.data && typeof crumb.data.status === 'number' ? <span className="numeric"> {String(crumb.data.status)}</span> : null}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {contextEntries.length > 0 || Object.keys(event.tags).length > 0 ? (
        <section aria-label="Context">
          <h3>Context</h3>
          <dl className="facts">
            {contextEntries.map(([key, value]) => <Fragment key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{String(value)}</dd></Fragment>)}
          </dl>
          {Object.keys(event.tags).length > 0 ? <div className="chip-list">{Object.entries(event.tags).map(([key, value]) => <span className="chip" key={key}>{key}: {value}</span>)}</div> : null}
        </section>
      ) : null}

      {extraEntries.length > 0 ? (
        <section aria-label="Additional details">
          <h3>Additional details</h3>
          {extraEntries.map(([key, value]) => (
            <div className="issues-extra" key={key}>
              <span className="issues-crumb-category">{key.replace(/_/g, ' ')}</span>
              <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
