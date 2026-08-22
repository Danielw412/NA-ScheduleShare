import { Archive, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CirclePlus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { demoBellScheduleWindow } from '../../lib/bellSchedule'
import type {
  AdminSchoolDayContext,
  BellCampus,
  BellCampusScope,
  BellScheduleBlock,
  BellScheduleDefinition,
  BellScheduleSettings,
  BellScheduleSyncRun,
  DayType,
} from '../../lib/domain'
import {
  adminArchiveBellSchedule,
  adminBulkAssignSchoolDays,
  adminClearSchoolDayOverrides,
  adminGetBellScheduleSettings,
  adminListBellScheduleSyncRuns,
  adminListBellSchedules,
  adminListSchoolDays,
  adminSaveBellSchedule,
  adminUnlockSchoolDayOverrides,
  adminUpdateBellScheduleSettings,
  invokeBellScheduleSync,
} from '../../lib/supabase/data'

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function validateBellScheduleDraft(schedule: BellScheduleDefinition): string | null {
  if (!schedule.display_name.trim() || schedule.display_name.trim().length > 100) return 'Enter a schedule name up to 100 characters.'
  if (!/^[a-z0-9][a-z0-9_]{1,62}$/.test(schedule.schedule_key)) return 'Use a lowercase schedule key with letters, numbers, and underscores.'
  if (schedule.warning_time && !timePattern.test(schedule.warning_time)) return 'The warning bell must use minute precision.'
  if (schedule.blocks.length < 1 || schedule.blocks.length > 30) return 'A schedule needs 1–30 blocks.'
  const periods = new Set<number>()
  const ordered = [...schedule.blocks].sort((left, right) => left.position - right.position)
  for (const [index, block] of ordered.entries()) {
    if (!block.label.trim()) return `Block ${index + 1} needs a label.`
    if (!timePattern.test(block.start_time) || !timePattern.test(block.end_time) || block.start_time >= block.end_time) {
      return `${block.label || `Block ${index + 1}`} needs a start time before its end time.`
    }
    if (index > 0 && ordered[index - 1].end_time > block.start_time) return `${ordered[index - 1].label} overlaps ${block.label}.`
    if (block.period_number !== null) {
      if (!Number.isInteger(block.period_number) || block.period_number < 1 || block.period_number > 9) return 'Class periods must be numbered 1–9.'
      if (periods.has(block.period_number)) return `Period ${block.period_number} is duplicated.`
      periods.add(block.period_number)
    }
  }
  return null
}

function monthStart(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function addDays(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + count)
  return value.toISOString().slice(0, 10)
}

function addMinutes(time: string, count: number): string {
  const [hours, minutes] = time.split(':').map(Number)
  const total = Math.min((23 * 60) + 59, (hours * 60) + minutes + count)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function monthGrid(start: string): string[] {
  const first = new Date(`${start}T12:00:00Z`)
  const mondayOffset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => addDays(start, index - mondayOffset))
}

function monthLabel(start: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T12:00:00Z`))
}

function cloneSchedule(schedule: BellScheduleDefinition): BellScheduleDefinition {
  return { ...schedule, blocks: schedule.blocks.map((block) => ({ ...block })) }
}

function blankSchedule(): BellScheduleDefinition {
  return {
    id: '',
    schedule_key: 'custom_schedule',
    display_name: 'Custom schedule',
    campus_scope: 'BOTH',
    warning_time: '07:24',
    is_builtin: false,
    archived_at: null,
    updated_at: '',
    blocks: [{ position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' }],
  }
}

function demoData() {
  const regular = demoBellScheduleWindow('2026-08-18', 1)[0].schedule as BellScheduleDefinition
  const settings: BellScheduleSettings = {
    school_year_start: '2026-08-18',
    semester_2_start: '2027-01-12',
    school_year_end: '2027-05-28',
    default_schedule_id: regular.id,
    school_timezone: 'America/New_York',
    sync_enabled: false,
    sync_time: '06:00',
    bell_schedule_document_url: 'https://docs.google.com/document/d/1KJr6cJszOP_UQP2ep5GputRwdC4YDYiShc4E-z5naNE/edit',
    newsletter_document_url: 'https://docs.google.com/document/d/1eUkh1tDSTTzIVooFoo5JZs0pzUp6GAqdk0DIse96IJU/edit',
    updated_at: '',
  }
  return { schedules: [regular], settings }
}

export function BellScheduleAdminPanel({ isDemo }: { isDemo: boolean }) {
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [schedules, setSchedules] = useState<BellScheduleDefinition[]>([])
  const [schoolDays, setSchoolDays] = useState<AdminSchoolDayContext[]>([])
  const [settings, setSettings] = useState<BellScheduleSettings | null>(null)
  const [runs, setRuns] = useState<BellScheduleSyncRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [campuses, setCampuses] = useState<Set<BellCampus>>(new Set(['NAI', 'NASH']))
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [noSchool, setNoSchool] = useState(false)
  const [assignmentScheduleId, setAssignmentScheduleId] = useState('')
  const [draft, setDraft] = useState<BellScheduleDefinition | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isDemo) {
        const demo = demoData()
        setSchedules(demo.schedules)
        setSettings(demo.settings)
        setAssignmentScheduleId(demo.settings.default_schedule_id)
        setRuns([])
        setSchoolDays([])
      } else {
        const [nextSchedules, nextDays, nextSettings, nextRuns] = await Promise.all([
          adminListBellSchedules(),
          adminListSchoolDays(month, 42),
          adminGetBellScheduleSettings(),
          adminListBellScheduleSyncRuns(),
        ])
        setSchedules(nextSchedules)
        setSchoolDays(nextDays)
        setSettings(nextSettings)
        setRuns(nextRuns)
        setAssignmentScheduleId((current) => current || nextSettings.default_schedule_id)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bell-schedule administration could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [isDemo, month])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (draft || schedules.length === 0) return
    setDraft(cloneSchedule(schedules.find((schedule) => schedule.archived_at === null) ?? schedules[0]))
  }, [draft, schedules])

  const gridDates = useMemo(() => monthGrid(month), [month])
  const currentMonthPrefix = month.slice(0, 7)
  const activeSchedules = schedules.filter((schedule) => !schedule.archived_at)
  const sourcesVerified = runs.some((run) => run.status === 'previewed' || run.status === 'succeeded')

  function chooseDate(date: string, range: boolean) {
    setSelectedDates((current) => {
      const next = new Set(current)
      if (range && selectionAnchor) {
        const [first, last] = [selectionAnchor, date].sort()
        for (const candidate of gridDates) if (candidate >= first && candidate <= last) next.add(candidate)
      } else if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
    setSelectionAnchor(date)
  }

  function selectWeekdays() {
    setSelectedDates(new Set(gridDates.filter((date) => date.startsWith(currentMonthPrefix)
      && weekdays.has(new Date(`${date}T12:00:00Z`).getUTCDay()))))
  }

  async function assignDates() {
    if (selectedDates.size === 0 || campuses.size === 0) return
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await adminBulkAssignSchoolDays({
        dates: [...selectedDates].sort(),
        campuses: [...campuses],
        dayType: dayType || null,
        noSchool,
        scheduleId: noSchool ? null : assignmentScheduleId,
      })
      setMessage(`${selectedDates.size} date${selectedDates.size === 1 ? '' : 's'} assigned and manually locked.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The selected dates could not be assigned.')
    } finally { setBusy(false) }
  }

  async function alterOverrides(action: 'unlock' | 'clear') {
    if (selectedDates.size === 0 || campuses.size === 0) return
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) {
        if (action === 'unlock') await adminUnlockSchoolDayOverrides([...selectedDates], [...campuses])
        else await adminClearSchoolDayOverrides([...selectedDates], [...campuses])
      }
      setMessage(action === 'unlock' ? 'Selected dates can now be managed by automation.' : 'Selected date overrides were cleared.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The calendar overrides could not be updated.')
    } finally { setBusy(false) }
  }

  function updateDraftBlock(index: number, patch: Partial<BellScheduleBlock>) {
    setDraft((current) => current ? {
      ...current,
      blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block),
    } : current)
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current
      const target = index + direction
      if (target < 0 || target >= current.blocks.length) return current
      const blocks = [...current.blocks]
      ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
      return { ...current, blocks: blocks.map((block, position) => ({ ...block, position: position + 1 })) }
    })
  }

  async function saveDraft() {
    if (!draft) return
    const validation = validateBellScheduleDraft(draft)
    if (validation) { setError(validation); return }
    setBusy(true)
    setError(null)
    try {
      if (isDemo) {
        const next = { ...cloneSchedule(draft), id: draft.id || `demo-${Date.now()}`, updated_at: new Date().toISOString() }
        setSchedules((current) => current.some((schedule) => schedule.id === next.id)
          ? current.map((schedule) => schedule.id === next.id ? next : schedule)
          : [...current, next])
        setDraft(next)
      } else {
        const id = await adminSaveBellSchedule(draft)
        await load()
        setDraft((current) => current ? { ...current, id } : current)
      }
      setMessage(`${draft.display_name} was saved.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The bell schedule could not be saved.')
    } finally { setBusy(false) }
  }

  async function archiveDraft() {
    if (!draft?.id || draft.is_builtin || !window.confirm(`Archive ${draft.display_name}?`)) return
    setBusy(true)
    try {
      if (!isDemo) await adminArchiveBellSchedule(draft.id)
      setDraft(null)
      await load()
      setMessage('The custom schedule was archived.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The schedule could not be archived.') }
    finally { setBusy(false) }
  }

  async function saveSettings() {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateBellScheduleSettings(settings)
      setMessage('School-year and automation settings were saved.')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Settings could not be saved.') }
    finally { setBusy(false) }
  }

  async function sync(preview: boolean) {
    setBusy(true)
    setError(null)
    try {
      if (!isDemo) await invokeBellScheduleSync(preview)
      setMessage(preview ? 'Preview complete. Review the newest run below.' : 'Sync complete. Validated, unlocked dates were applied.')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The newsletter sync could not run.') }
    finally { setBusy(false) }
  }

  return <div className="bell-admin">
    <header className="section-heading bell-admin-heading"><div><h2>Bell schedules</h2><p>Edit authoritative bell times, assign calendar dates, and review the Google Docs/Gemini detector.</p></div><button className="button button-secondary" type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} /> Refresh</button></header>
    {message ? <div className="toast-message" role="status">{message}<button type="button" onClick={() => setMessage(null)}>×</button></div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="notice-box">Loading bell schedules…</p> : null}

    <section className="admin-section bell-admin-card bell-calendar-section">
      <div className="bell-card-heading"><div><span className="eyebrow">Calendar</span><h3>School-day assignments</h3><p>Select individual dates, shift-click a range, or select chosen weekdays in the month.</p></div><div className="month-controls"><button type="button" aria-label="Previous month" onClick={() => { const date = new Date(`${month}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); setMonth(monthStart(date)) }}><ChevronLeft /></button><strong>{monthLabel(month)}</strong><button type="button" aria-label="Next month" onClick={() => { const date = new Date(`${month}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); setMonth(monthStart(date)) }}><ChevronRight /></button></div></div>
      <div className="weekday-filter" aria-label="Weekday filters">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => <button type="button" className={weekdays.has(index) ? 'is-active' : ''} aria-pressed={weekdays.has(index)} key={label} onClick={() => setWeekdays((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })}>{label}</button>)}<button type="button" onClick={selectWeekdays}>Select weekdays</button><button type="button" onClick={() => setSelectedDates(new Set())}>Clear selection</button></div>
      <div className="bell-month-grid"><div className="bell-week-labels">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>{gridDates.map((date) => {
        const rows = schoolDays.filter((row) => row.date === date)
        return <button type="button" key={date} className={`${date.startsWith(currentMonthPrefix) ? '' : 'is-outside'} ${selectedDates.has(date) ? 'is-selected' : ''}`} aria-pressed={selectedDates.has(date)} onClick={(event) => chooseDate(date, event.shiftKey)}><strong>{Number(date.slice(-2))}</strong><span>{rows.map((row) => <small key={row.campus} className={`source-${row.source}`}>{row.campus} {row.no_school ? 'Closed' : `${row.day_type ?? '–'} · ${row.schedule_key?.replaceAll('_', ' ') ?? 'Regular'}`}{row.manual_locked ? ' 🔒' : ''}</small>)}</span></button>
      })}</div>
      <div className="bell-assignment-controls">
        <fieldset><legend>Campus</legend>{(['NAI', 'NASH'] as BellCampus[]).map((campus) => <label key={campus}><input type="checkbox" checked={campuses.has(campus)} onChange={() => setCampuses((current) => { const next = new Set(current); if (next.has(campus)) next.delete(campus); else next.add(campus); return next })} /> {campus}</label>)}</fieldset>
        <label>A/B day<select value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}><option value="">Not assigned</option><option value="A">A day</option><option value="B">B day</option></select></label>
        <label>Bell schedule<select disabled={noSchool} value={assignmentScheduleId} onChange={(event) => setAssignmentScheduleId(event.target.value)}>{activeSchedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.display_name} · {schedule.campus_scope}</option>)}</select></label>
        <label className="checkbox-row compact"><input type="checkbox" checked={noSchool} onChange={(event) => setNoSchool(event.target.checked)} /> No school</label>
        <div className="form-actions"><button className="button button-primary" type="button" disabled={busy || selectedDates.size === 0 || (!noSchool && !assignmentScheduleId)} onClick={() => void assignDates()}>Assign {selectedDates.size || ''} date{selectedDates.size === 1 ? '' : 's'}</button><button className="button button-secondary" type="button" disabled={busy || selectedDates.size === 0} onClick={() => void alterOverrides('unlock')}>Unlock for AI</button><button className="button button-secondary" type="button" disabled={busy || selectedDates.size === 0} onClick={() => void alterOverrides('clear')}>Clear overrides</button></div>
      </div>
    </section>

    <section className="admin-section bell-admin-card bell-editor-section">
      <div className="bell-card-heading"><div><span className="eyebrow">Bell-time editor</span><h3>Definitions and blocks</h3><p>Passing time is the gap between blocks. Built-ins can be adjusted; custom definitions can be archived when unused.</p></div><div className="form-actions"><select aria-label="Bell schedule to edit" value={draft?.id ?? ''} onChange={(event) => setDraft(cloneSchedule(schedules.find((schedule) => schedule.id === event.target.value) ?? blankSchedule()))}>{schedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.archived_at ? 'Archived · ' : ''}{schedule.display_name}</option>)}</select><button className="button button-secondary" type="button" onClick={() => setDraft(blankSchedule())}><CirclePlus size={16} /> Custom</button></div></div>
      {draft ? <div className="bell-editor">
        <div className="bell-editor-metadata"><label>Name<input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label><label>Key<input disabled={draft.is_builtin || Boolean(draft.id)} value={draft.schedule_key} onChange={(event) => setDraft({ ...draft, schedule_key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></label><label>Campus<select disabled={draft.is_builtin} value={draft.campus_scope} onChange={(event) => setDraft({ ...draft, campus_scope: event.target.value as BellCampusScope })}><option value="BOTH">Both</option><option value="NAI">NAI</option><option value="NASH">NASH</option></select></label><label>Warning bell<input type="time" step="60" value={draft.warning_time ?? ''} onChange={(event) => setDraft({ ...draft, warning_time: event.target.value || null })} /></label></div>
        <div className="bell-block-editor"><div className="bell-block-head"><span>Order</span><span>Block</span><span>Period</span><span>Starts</span><span>Ends</span><span>Actions</span></div>{draft.blocks.map((block, index) => <div className="bell-block-row" key={block.id ?? `${index}-${block.label}`}><span>{index + 1}</span><input aria-label={`Block ${index + 1} label`} value={block.label} onChange={(event) => updateDraftBlock(index, { label: event.target.value })} /><select aria-label={`${block.label} period`} value={block.period_number ?? ''} onChange={(event) => { const period = event.target.value ? Number(event.target.value) : null; updateDraftBlock(index, { period_number: period, kind: period === null ? 'non_class' : 'class', label: block.label || (period ? `Period ${period}` : 'Activity Period') }) }}><option value="">Named block</option>{Array.from({ length: 9 }, (_, period) => <option value={period + 1} key={period + 1}>Period {period + 1}</option>)}</select><input aria-label={`${block.label} start time`} type="time" step="60" value={block.start_time} onChange={(event) => updateDraftBlock(index, { start_time: event.target.value })} /><input aria-label={`${block.label} end time`} type="time" step="60" value={block.end_time} onChange={(event) => updateDraftBlock(index, { end_time: event.target.value })} /><span className="row-actions"><button type="button" aria-label={`Move ${block.label} up`} disabled={index === 0} onClick={() => moveBlock(index, -1)}><ChevronUp /></button><button type="button" aria-label={`Move ${block.label} down`} disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ChevronDown /></button><button type="button" aria-label={`Remove ${block.label}`} disabled={draft.blocks.length === 1} onClick={() => setDraft({ ...draft, blocks: draft.blocks.filter((_, blockIndex) => blockIndex !== index).map((item, position) => ({ ...item, position: position + 1 })) })}><Trash2 /></button></span></div>)}</div>
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { const start = draft.blocks.at(-1)?.end_time ?? '07:28'; setDraft({ ...draft, blocks: [...draft.blocks, { position: draft.blocks.length + 1, kind: 'non_class', label: 'Custom block', period_number: null, start_time: start, end_time: addMinutes(start, 30) }] }) }}><CirclePlus size={16} /> Add block</button>{!draft.is_builtin && draft.id ? <button className="button button-secondary danger-text" type="button" disabled={busy} onClick={() => void archiveDraft()}><Archive size={16} /> Archive</button> : null}<button className="button button-primary" type="button" disabled={busy} onClick={() => void saveDraft()}><Save size={16} /> Save times</button></div>
      </div> : null}
    </section>

    {settings ? <section className="admin-section bell-admin-card bell-automation-section">
      <div className="bell-card-heading"><div><span className="eyebrow">Automation</span><h3>Daily Google Docs detection</h3><p>Runs in Eastern time with Gemini high thinking. Reasoning thoughts are never returned or stored.</p></div><span className={`connection-badge ${sourcesVerified ? 'is-connected' : ''}`}>{sourcesVerified ? 'Sources verified' : 'Not verified yet'}</span></div>
      <div className="bell-settings-grid"><label className="checkbox-row"><input type="checkbox" checked={settings.sync_enabled} onChange={(event) => setSettings({ ...settings, sync_enabled: event.target.checked })} /><span><strong>Enable daily detection</strong><small>The five-minute database check invokes the function once when this time is due.</small></span></label><label>Daily time (Eastern)<input type="time" step="60" value={settings.sync_time} onChange={(event) => setSettings({ ...settings, sync_time: event.target.value })} /></label><label>First day<input type="date" value={settings.school_year_start} onChange={(event) => setSettings({ ...settings, school_year_start: event.target.value })} /></label><label>Semester 2 starts<input type="date" value={settings.semester_2_start} onChange={(event) => setSettings({ ...settings, semester_2_start: event.target.value })} /></label><label>Last day<input type="date" value={settings.school_year_end} onChange={(event) => setSettings({ ...settings, school_year_end: event.target.value })} /></label><label>Default schedule<select value={settings.default_schedule_id} onChange={(event) => setSettings({ ...settings, default_schedule_id: event.target.value })}>{activeSchedules.filter((schedule) => schedule.campus_scope === 'BOTH').map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.display_name}</option>)}</select></label><label className="wide-field">Bell-schedule Google Doc<input value={settings.bell_schedule_document_url} onChange={(event) => setSettings({ ...settings, bell_schedule_document_url: event.target.value })} /></label><label className="wide-field">Newsletter Google Doc<input value={settings.newsletter_document_url} onChange={(event) => setSettings({ ...settings, newsletter_document_url: event.target.value })} /></label></div>
      <div className="form-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void saveSettings()}><Save size={16} /> Save settings</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void sync(true)}>Preview now</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void sync(false)}>Sync now</button></div>
    </section> : null}

    <section className="admin-section bell-admin-card bell-history-section">
      <div className="bell-card-heading"><div><span className="eyebrow">Run history</span><h3>Extraction evidence</h3><p>Newest 100 runs are retained; this screen loads at most 25.</p></div><CalendarDays aria-hidden="true" /></div>
      {runs.length === 0 ? <p className="notice-box">No Google Docs detection runs yet.</p> : <div className="bell-run-list">{runs.map((run) => <details key={run.id}><summary><span><strong>{run.status}</strong><small>{new Date(run.created_at).toLocaleString()} · {run.trigger_type} · {run.model_id ?? 'No model'}</small></span><span>{run.timing_ms === null ? '—' : `${run.timing_ms} ms`}</span></summary><div className="bell-run-details">{run.error_message ? <p className="form-error">{run.error_message}</p> : null}<h4>Source section</h4><pre>{run.source_section ?? 'No source text stored.'}</pre><h4>Evidence</h4><pre>{JSON.stringify(run.evidence, null, 2)}</pre><h4>Validated extraction</h4><pre>{JSON.stringify(run.validated_extraction, null, 2)}</pre><h4>Applied dates</h4><pre>{JSON.stringify(run.applied_dates, null, 2)}</pre><h4>Preserved / skipped</h4><pre>{JSON.stringify(run.skipped_dates, null, 2)}</pre><h4>Raw Gemini JSON</h4><pre>{JSON.stringify(run.raw_gemini_json, null, 2)}</pre></div></details>)}</div>}
    </section>
  </div>
}
