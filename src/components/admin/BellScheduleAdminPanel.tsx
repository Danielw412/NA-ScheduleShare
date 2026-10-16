import { AlertCircle, Archive, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CirclePlus, Lock, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DayTimeline } from '../bell/DayTimeline'
import { NowBoard } from '../bell/NowBoard'
import { useToast } from '../ui/Toast'
import { AdminSectionHeading } from './AdminSectionHeading'
import { useAdminDialogs } from './AdminDialogs'
import { AdminRowMenu } from './AdminRowMenu'
import { blockMark, demoBellScheduleWindow, easternDateKey, easternLocalTime, resolveBellNow, resolveNextClassTiming, SCHOOL_TIME_ZONE } from '../../lib/bellSchedule'
import type {
  AdminSchoolDayContext,
  BellCampus,
  BellCampusScope,
  BellScheduleBlock,
  BellScheduleDefinition,
  BellScheduleSettings,
  BellScheduleSyncRun,
  DayType,
  ScheduleEnrollment,
  SchoolDayContext,
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

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const previewDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' })
const runTimeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function cloneSchedule(schedule: BellScheduleDefinition): BellScheduleDefinition {
  return { ...schedule, blocks: schedule.blocks.map((block) => ({ ...block })) }
}

function assignmentErrorMessage(caught: unknown): string {
  const message = caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string'
    ? caught.message
    : ''
  if (message.includes('bell_schedule_campus_mismatch')) return 'This bell schedule does not apply to every selected campus.'
  return message || 'The selected dates could not be assigned.'
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
    newsletter_document_url: 'https://docs.google.com/document/d/1eUkh1tDSTTzIVooFoo5JZs0pzUp6GAqdk0DIse96IJU/edit',
    updated_at: '',
  }
  return { schedules: [regular], settings }
}

/** Demo-mode calendar rows so the month grid shows each assignment state. */
function demoSchoolDays(startDate: string, schedule: BellScheduleDefinition): AdminSchoolDayContext[] {
  return (['NAI', 'NASH'] as BellCampus[]).flatMap((campus) => demoBellScheduleWindow(startDate, 42, campus)
    .filter((day) => !day.no_school)
    .map((day): AdminSchoolDayContext => {
      const dayOfMonth = Number(day.date.slice(-2))
      const manual = dayOfMonth === 13
      return {
        date: day.date,
        campus,
        day_type: manual ? null : day.day_type,
        no_school: manual,
        schedule_id: manual ? null : schedule.id,
        schedule_key: manual ? null : dayOfMonth === 21 ? 'two_hour_delay' : schedule.schedule_key,
        source: manual ? 'manual' : dayOfMonth >= 20 && dayOfMonth <= 23 ? 'ai' : 'default',
        manual_locked: manual,
        evidence: null,
      }
    }))
}

function previewSchoolDays(
  startDate: string,
  schedule: BellScheduleDefinition,
  campus: BellCampus,
  dayType: DayType,
  noSchool: boolean,
  semesterTwoStart: string,
): SchoolDayContext[] {
  return Array.from({ length: 21 }, (_, index) => {
    const date = addDays(startDate, index)
    const weekDay = new Date(`${date}T12:00:00Z`).getUTCDay()
    const closed = index === 0 ? noSchool : weekDay === 0 || weekDay === 6
    return {
      date,
      campus,
      day_type: closed ? null : dayType,
      semester: date >= semesterTwoStart ? 'semester_2' : 'semester_1',
      no_school: closed,
      source: index === 0 ? 'manual' : 'default',
      schedule: closed ? null : schedule,
    }
  })
}

function previewEnrollment(dayType: DayType, periodNumber: number | null, courseName: string): ScheduleEnrollment[] {
  if (periodNumber === null) return []
  const meetingSlots = [{ day_type: dayType, period_number: periodNumber }]
  return [{
    id: 'admin-preview-enrollment',
    class_id: 'admin-preview-class',
    student_id: 'admin-preview-student',
    academic_term: 'full_year',
    active: true,
    created_at: '',
    updated_at: '',
    meeting_slots: meetingSlots,
    class: {
      id: 'admin-preview-class',
      course_name_id: 'admin-preview-course',
      course_name: courseName,
      teacher_last_name: 'Preview',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: meetingSlots,
    },
  }]
}

const sourceLabels: Record<AdminSchoolDayContext['source'], string> = {
  manual: 'set manually',
  ai: 'set by the newsletter sync',
  default: 'default',
}

const runStatus: Record<BellScheduleSyncRun['status'], { label: string; badge: string }> = {
  running: { label: 'Running', badge: 'badge badge-info' },
  previewed: { label: 'Previewed', badge: 'badge badge-outline' },
  succeeded: { label: 'Succeeded', badge: 'badge badge-success' },
  skipped: { label: 'Skipped', badge: 'badge' },
  failed: { label: 'Failed', badge: 'badge badge-danger' },
}

const runTriggerLabels: Record<BellScheduleSyncRun['trigger_type'], string> = {
  scheduled: 'Scheduled',
  manual: 'Run manually',
  preview: 'Preview',
}

function scheduleName(key: string | null): string {
  if (!key) return 'Regular'
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** One short label per day for phone-sized calendars: "A", "Off", or "A B" when campuses differ. */
function compactDaySummary(rows: AdminSchoolDayContext[]): string {
  const labels = rows.map((row) => row.no_school ? 'Off' : row.day_type ?? '–')
  return new Set(labels).size === 1 ? labels[0] : labels.join(' ')
}

/** Everything the calendar knows about one date, per campus. */
function describeSchoolDay(rows: AdminSchoolDayContext[]): string {
  return rows.map((row) => `${row.campus} ${row.no_school ? 'no school' : `${row.day_type ? `${row.day_type} day` : 'no A/B day'}, ${scheduleName(row.schedule_key)}`}, ${sourceLabels[row.source]}${row.manual_locked ? ', locked' : ''}`).join('; ')
}

/** A school day on a bell schedule other than the default one. */
function usesSpecialSchedule(rows: AdminSchoolDayContext[], defaultScheduleKey: string | undefined): boolean {
  return defaultScheduleKey !== undefined
    && rows.some((row) => !row.no_school && row.schedule_key !== null && row.schedule_key !== defaultScheduleKey)
}

function campusOptionLabel(schedule: BellScheduleDefinition): string {
  return schedule.campus_scope === 'BOTH' ? schedule.display_name : `${schedule.display_name} (${schedule.campus_scope} only)`
}

type FeedbackScope = 'load' | 'calendar' | 'editor' | 'settings'
const weekdayToggles: Array<{ index: number; label: string; name: string }> = [
  { index: 1, label: 'Mon', name: 'Mondays' },
  { index: 2, label: 'Tue', name: 'Tuesdays' },
  { index: 3, label: 'Wed', name: 'Wednesdays' },
  { index: 4, label: 'Thu', name: 'Thursdays' },
  { index: 5, label: 'Fri', name: 'Fridays' },
  { index: 6, label: 'Sat', name: 'Saturdays' },
  { index: 0, label: 'Sun', name: 'Sundays' },
]

export function BellScheduleAdminPanel({ isDemo }: { isDemo: boolean }) {
  const { showToast } = useToast()
  const dialogs = useAdminDialogs()
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [schedules, setSchedules] = useState<BellScheduleDefinition[]>([])
  const [schoolDays, setSchoolDays] = useState<AdminSchoolDayContext[]>([])
  const [settings, setSettings] = useState<BellScheduleSettings | null>(null)
  const [runs, setRuns] = useState<BellScheduleSyncRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ scope: FeedbackScope; message: string } | null>(null)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [campuses, setCampuses] = useState<Set<BellCampus>>(new Set(['NAI', 'NASH']))
  const [dayType, setDayType] = useState<DayType | ''>('')
  const [noSchool, setNoSchool] = useState(false)
  const [assignmentScheduleId, setAssignmentScheduleId] = useState('')
  const [draft, setDraft] = useState<BellScheduleDefinition | null>(null)
  const [previewDate, setPreviewDate] = useState(() => easternDateKey(new Date()))
  const [previewTime, setPreviewTime] = useState('07:30')
  const [previewCampus, setPreviewCampus] = useState<BellCampus>('NASH')
  const [previewDayType, setPreviewDayType] = useState<DayType>('A')
  const [previewNoSchool, setPreviewNoSchool] = useState(false)
  const [previewPeriod, setPreviewPeriod] = useState<number | null>(1)
  const [previewClassName, setPreviewClassName] = useState('AP Psychology')

  const fail = useCallback((scope: FeedbackScope, message: string) => setFeedback({ scope, message }), [])

  const load = useCallback(async () => {
    setLoading(true)
    setFeedback(null)
    try {
      if (isDemo) {
        const demo = demoData()
        setSchedules(demo.schedules)
        setSettings(demo.settings)
        setAssignmentScheduleId(demo.settings.default_schedule_id)
        setRuns([])
        setSchoolDays(demoSchoolDays(monthGrid(month)[0], demo.schedules[0]))
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
      fail('load', caught instanceof Error ? caught.message : 'Bell-schedule administration could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [fail, isDemo, month])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (draft || schedules.length === 0) return
    setDraft(cloneSchedule(schedules.find((schedule) => schedule.archived_at === null) ?? schedules[0]))
  }, [draft, schedules])
  useEffect(() => {
    const activeClassPeriod = draft?.blocks.find((block) => block.kind === 'class'
      && previewTime >= block.start_time
      && previewTime < block.end_time)?.period_number
    if (activeClassPeriod !== null && activeClassPeriod !== undefined) setPreviewPeriod(activeClassPeriod)
  }, [draft, previewTime])

  const gridDates = useMemo(() => monthGrid(month), [month])
  const currentMonthPrefix = month.slice(0, 7)
  const todayKey = easternDateKey(new Date())
  const activeSchedules = schedules.filter((schedule) => !schedule.archived_at)
  const assignmentSchedule = activeSchedules.find((schedule) => schedule.id === assignmentScheduleId)
  const sourcesVerified = runs.some((run) => run.status === 'previewed' || run.status === 'succeeded')
  const previewNow = useMemo(() => easternLocalTime(previewDate, previewTime), [previewDate, previewTime])
  const previewDays = useMemo(
    () => draft ? previewSchoolDays(
      previewDate,
      draft,
      previewCampus,
      previewDayType,
      previewNoSchool,
      settings?.semester_2_start ?? previewDate,
    ) : [],
    [draft, previewCampus, previewDate, previewDayType, previewNoSchool, settings?.semester_2_start],
  )
  const previewEnrollments = useMemo(
    () => previewEnrollment(previewDayType, previewPeriod, previewClassName),
    [previewClassName, previewDayType, previewPeriod],
  )
  const previewBell = useMemo(() => resolveBellNow(previewNow, previewDays), [previewDays, previewNow])
  // Same rule as the homepage: a student with classes also sees their own next
  // class when it is later than the next bell.
  const previewNextClass = useMemo(
    () => previewEnrollments.some((enrollment) => enrollment.active) ? resolveNextClassTiming(previewNow, previewDays, previewEnrollments) : null,
    [previewDays, previewEnrollments, previewNow],
  )

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

  function shiftMonth(direction: -1 | 1) {
    const date = new Date(`${month}T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + direction)
    setMonth(monthStart(date))
  }

  async function assignDates() {
    if (selectedDates.size === 0 || campuses.size === 0) return
    if (!noSchool && assignmentSchedule && assignmentSchedule.campus_scope !== 'BOTH'
      && (campuses.size !== 1 || !campuses.has(assignmentSchedule.campus_scope))) {
      fail('calendar', `This bell schedule only applies to ${assignmentSchedule.campus_scope}.`)
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      if (!isDemo) await adminBulkAssignSchoolDays({
        dates: [...selectedDates].sort(),
        campuses: [...campuses],
        dayType: dayType || null,
        noSchool,
        scheduleId: noSchool ? null : assignmentScheduleId,
      })
      showToast(`${selectedDates.size} date${selectedDates.size === 1 ? '' : 's'} assigned and manually locked.`)
      await load()
    } catch (caught) {
      fail('calendar', assignmentErrorMessage(caught))
    } finally { setBusy(false) }
  }

  async function alterOverrides(action: 'unlock' | 'clear') {
    if (selectedDates.size === 0 || campuses.size === 0) return
    setBusy(true)
    setFeedback(null)
    try {
      if (!isDemo) {
        if (action === 'unlock') await adminUnlockSchoolDayOverrides([...selectedDates], [...campuses])
        else await adminClearSchoolDayOverrides([...selectedDates], [...campuses])
      }
      showToast(action === 'unlock' ? 'Selected dates can now be managed by automation.' : 'Selected date overrides were cleared.')
      await load()
    } catch (caught) {
      fail('calendar', caught instanceof Error ? caught.message : 'The calendar overrides could not be updated.')
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

  function removeBlock(index: number) {
    setDraft((current) => current && current.blocks.length > 1 ? {
      ...current,
      blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index).map((item, position) => ({ ...item, position: position + 1 })),
    } : current)
  }

  async function saveDraft() {
    if (!draft) return
    const validation = validateBellScheduleDraft(draft)
    if (validation) { fail('editor', validation); return }
    setBusy(true)
    setFeedback(null)
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
      showToast(`${draft.display_name} was saved.`)
    } catch (caught) {
      fail('editor', caught instanceof Error ? caught.message : 'The bell schedule could not be saved.')
    } finally { setBusy(false) }
  }

  async function archiveDraft() {
    if (!draft?.id || draft.is_builtin) return
    const confirmed = await dialogs.confirm({
      title: `Archive ${draft.display_name}?`,
      message: 'It can no longer be assigned to school days. Days that already use it keep their bell times.',
      confirmLabel: 'Archive schedule',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      if (!isDemo) await adminArchiveBellSchedule(draft.id)
      setDraft(null)
      await load()
      showToast('The custom schedule was archived.')
    } catch (caught) { fail('editor', caught instanceof Error ? caught.message : 'The schedule could not be archived.') }
    finally { setBusy(false) }
  }

  async function saveSettings() {
    if (!settings) return
    setBusy(true)
    setFeedback(null)
    try {
      if (!isDemo) await adminUpdateBellScheduleSettings(settings)
      showToast('School-year and automation settings were saved.')
      await load()
    } catch (caught) { fail('settings', caught instanceof Error ? caught.message : 'Settings could not be saved.') }
    finally { setBusy(false) }
  }

  async function sync(preview: boolean) {
    setBusy(true)
    setFeedback(null)
    try {
      if (!isDemo) await invokeBellScheduleSync(preview)
      showToast(preview ? 'Preview complete. Review the newest run below.' : 'Sync complete. Validated, unlocked dates were applied.')
      await load()
    } catch (caught) { fail('settings', caught instanceof Error ? caught.message : 'The newsletter sync could not run.') }
    finally { setBusy(false) }
  }

  function feedbackFor(scope: FeedbackScope) {
    return feedback?.scope === scope ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{feedback.message}</p> : null
  }

  const selectedCount = selectedDates.size
  const defaultScheduleKey = schedules.find((schedule) => schedule.id === settings?.default_schedule_id)?.schedule_key
  // Phone-width cells only fit the A/B day, so the last day tapped is spelled out under the grid.
  const detailRows = selectionAnchor ? schoolDays.filter((row) => row.date === selectionAnchor) : []
  const previewDay = previewBell.day
  const previewDayLabel = previewDay ? previewDateFormatter.format(easternLocalTime(previewDay.date, '12:00')) : null

  return (
    <div className="admin-stack admin-bell">
      <section className="admin-section" aria-labelledby="admin-bell-title">
        <AdminSectionHeading
          id="admin-bell-title"
          title="Bell schedules"
          description="Set bell times, decide which schedule each school day uses, and check what the newsletter sync found."
          actions={<button className="button button-secondary button-sm" type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh</button>}
        />
        {feedbackFor('load')}
        {loading ? <div className="admin-skeleton" role="status" aria-label="Loading bell schedules"><span className="skeleton" /><span className="skeleton" /></div> : null}
      </section>

      <section className="admin-section" aria-labelledby="admin-bell-calendar-title">
        <AdminSectionHeading
          id="admin-bell-calendar-title"
          level={3}
          title="School-day assignments"
          description="Select days, then choose an A/B day and bell schedule. Shift-click to select a range. Days you assign are locked so the newsletter sync won’t change them."
        />
        <div className="admin-bell-calendar">
          <div className="admin-bell-month">
            <button className="icon-button is-outlined" type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft aria-hidden="true" /></button>
            <strong aria-live="polite">{monthLabel(month)}</strong>
            <button className="icon-button is-outlined" type="button" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight aria-hidden="true" /></button>
          </div>
          <div className="admin-bell-grid" role="group" aria-label={`Days in ${monthLabel(month)}`}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span className="admin-bell-weekday" aria-hidden="true" key={day}>{day}</span>)}
            {gridDates.map((date) => {
              const rows = schoolDays.filter((row) => row.date === date)
              const selected = selectedDates.has(date)
              const outside = !date.startsWith(currentMonthPrefix)
              const description = describeSchoolDay(rows)
              const sources = new Set(rows.map((row) => row.source))
              const compactClasses = ['admin-bell-compact', sources.size === 1 ? `is-${rows[0]?.source}` : ''].filter(Boolean).join(' ')
              const classes = ['admin-bell-day', outside ? 'is-outside' : '', selected ? 'is-selected' : '', date === todayKey ? 'is-today' : ''].filter(Boolean).join(' ')
              return (
                <button
                  type="button"
                  key={date}
                  className={classes}
                  aria-pressed={selected}
                  aria-label={`${dayLabelFormatter.format(new Date(`${date}T12:00:00Z`))}${description ? `. ${description}` : ''}`}
                  onClick={(event) => chooseDate(date, event.shiftKey)}
                >
                  <span className="admin-bell-date numeric" aria-hidden="true">{Number(date.slice(-2))}</span>
                  {rows.length > 0 ? <span className={compactClasses} aria-hidden="true">
                    {compactDaySummary(rows)}
                    {rows.some((row) => row.manual_locked) ? <Lock className="admin-bell-tag-lock" /> : null}
                    {usesSpecialSchedule(rows, defaultScheduleKey) ? <span className="admin-bell-special-mark" /> : null}
                  </span> : null}
                  {rows.length > 0 ? <span className="admin-bell-tags" aria-hidden="true">
                    {rows.map((row) => (
                      <span className={`admin-bell-tag is-${row.source}`} key={row.campus}>
                        <span className="admin-bell-tag-campus">{row.campus}</span>
                        <span className="admin-bell-tag-day">{row.no_school ? 'Off' : row.day_type ?? '–'}</span>
                        {!row.no_school ? <span className="admin-bell-tag-schedule">{scheduleName(row.schedule_key)}</span> : null}
                        {row.manual_locked ? <Lock className="admin-bell-tag-lock" aria-hidden="true" /> : null}
                      </span>
                    ))}
                  </span> : null}
                </button>
              )
            })}
          </div>
          {detailRows.length > 0 && selectionAnchor ? <p className="admin-bell-day-detail">
            <strong>{dayLabelFormatter.format(new Date(`${selectionAnchor}T12:00:00Z`))}</strong>
            <span>{describeSchoolDay(detailRows)}</span>
          </p> : null}
          <p className="admin-bell-legend">
            <span className="admin-bell-legend-item is-manual"><Lock aria-hidden="true" />Set manually and locked</span>
            <span className="admin-bell-legend-item is-ai">Set by the newsletter sync</span>
            <span className="admin-bell-legend-item is-default">Default</span>
            <span className="admin-bell-legend-item is-special"><span className="admin-bell-special-mark" aria-hidden="true" />Not the default bell schedule</span>
          </p>
        </div>

        <div className="admin-bell-quick">
          <fieldset className="admin-bell-weekdays">
            <legend>Select every</legend>
            <div className="admin-toggle-row">
              {weekdayToggles.map((day) => (
                <button type="button" className="admin-toggle" aria-pressed={weekdays.has(day.index)} aria-label={day.name} key={day.index} onClick={() => setWeekdays((current) => { const next = new Set(current); if (next.has(day.index)) next.delete(day.index); else next.add(day.index); return next })}>{day.label}</button>
              ))}
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="button button-secondary button-sm" type="button" onClick={selectWeekdays}>Select in {monthLabel(month).split(' ')[0]}</button>
            <button className="button button-ghost button-sm" type="button" disabled={selectedCount === 0} onClick={() => setSelectedDates(new Set())}>Clear selection</button>
          </div>
        </div>

        <div className="panel admin-bell-assign" aria-label="Assign selected days" role="group">
          <div className="admin-bell-assign-fields">
            <fieldset>
              <legend>Campus</legend>
              <div className="admin-toggle-row">
                {(['NAI', 'NASH'] as BellCampus[]).map((campus) => <label className="admin-check" key={campus}><input type="checkbox" checked={campuses.has(campus)} disabled={!noSchool && !!assignmentSchedule && assignmentSchedule.campus_scope !== 'BOTH' && assignmentSchedule.campus_scope !== campus} onChange={() => setCampuses((current) => { const next = new Set(current); if (next.has(campus)) next.delete(campus); else next.add(campus); return next })} />{campus}</label>)}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="admin-bell-assign-day">A/B day</label>
              <select id="admin-bell-assign-day" value={dayType} onChange={(event) => setDayType(event.target.value as DayType | '')}><option value="">Not assigned</option><option value="A">A day</option><option value="B">B day</option></select>
            </div>
            <div className="field">
              <label htmlFor="admin-bell-assign-schedule">Bell schedule</label>
              <select id="admin-bell-assign-schedule" disabled={noSchool} value={assignmentScheduleId} onChange={(event) => {
                const scheduleId = event.target.value
                setAssignmentScheduleId(scheduleId)
                const scope = activeSchedules.find((schedule) => schedule.id === scheduleId)?.campus_scope
                if (scope && scope !== 'BOTH') setCampuses(new Set([scope]))
              }}>{activeSchedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{campusOptionLabel(schedule)}</option>)}</select>
            </div>
            <label className="admin-check admin-bell-no-school"><input type="checkbox" checked={noSchool} onChange={(event) => setNoSchool(event.target.checked)} />No school</label>
          </div>
          {feedbackFor('calendar')}
          <div className="admin-bell-assign-actions">
            <span className="admin-bell-selected numeric" aria-live="polite">{selectedCount === 0 ? 'No days selected' : `${selectedCount} day${selectedCount === 1 ? '' : 's'} selected`}</span>
            <div className="form-actions">
              <button className="button button-secondary button-sm" type="button" disabled={busy || selectedCount === 0} onClick={() => void alterOverrides('unlock')}>Unlock for AI</button>
              <button className="button button-secondary button-sm" type="button" disabled={busy || selectedCount === 0} onClick={() => void alterOverrides('clear')}>Clear overrides</button>
              <button className="button button-primary" type="button" disabled={busy || selectedCount === 0 || (!noSchool && !assignmentScheduleId)} onClick={() => void assignDates()}>{selectedCount === 0 ? 'Assign dates' : `Assign ${selectedCount} date${selectedCount === 1 ? '' : 's'}`}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="admin-bell-editor-title">
        <AdminSectionHeading
          id="admin-bell-editor-title"
          level={3}
          title="Bell times"
          description="Passing time is the gap between blocks. Built-in schedules can be adjusted; custom ones can be archived when they’re no longer used."
        />
        <div className="admin-bell-editor-pick">
          <div className="field">
            <label htmlFor="admin-bell-edit-select">Bell schedule to edit</label>
            <select id="admin-bell-edit-select" value={draft?.id ?? ''} onChange={(event) => setDraft(cloneSchedule(schedules.find((schedule) => schedule.id === event.target.value) ?? blankSchedule()))}>
              {draft && !draft.id ? <option value="">{draft.display_name} (not saved)</option> : null}
              {schedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.archived_at ? `${schedule.display_name} (archived)` : schedule.display_name}</option>)}
            </select>
          </div>
          <button className="button button-secondary" type="button" onClick={() => setDraft(blankSchedule())}><CirclePlus aria-hidden="true" />New custom schedule</button>
        </div>
        {draft ? <div className="admin-bell-editor">
          <div className="admin-field-grid is-four">
            <div className="field">
              <label htmlFor="admin-bell-name">Name</label>
              <input id="admin-bell-name" value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="admin-bell-key">Key</label>
              <input id="admin-bell-key" className="admin-mono-input" disabled={draft.is_builtin || Boolean(draft.id)} value={draft.schedule_key} onChange={(event) => setDraft({ ...draft, schedule_key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            </div>
            <div className="field">
              <label htmlFor="admin-bell-campus">Campus</label>
              <select id="admin-bell-campus" disabled={draft.is_builtin} value={draft.campus_scope} onChange={(event) => setDraft({ ...draft, campus_scope: event.target.value as BellCampusScope })}><option value="BOTH">Both</option><option value="NAI">NAI</option><option value="NASH">NASH</option></select>
            </div>
            <div className="field">
              <label htmlFor="admin-bell-warning">Warning bell</label>
              <input id="admin-bell-warning" type="time" step="60" value={draft.warning_time ?? ''} onChange={(event) => setDraft({ ...draft, warning_time: event.target.value || null })} />
            </div>
          </div>

          <div className="panel admin-bell-blocks">
            <div className="admin-bell-block-head" aria-hidden="true"><span /><span>Block</span><span>Period</span><span>Starts</span><span>Ends</span><span /></div>
            <ol className="admin-bell-block-list" aria-label={`Blocks in ${draft.display_name || 'this schedule'}`}>
              {draft.blocks.map((block, index) => (
                <li className="admin-bell-block-row" key={block.id ?? `${index}-${block.label}`}>
                  <span className={block.kind === 'class' && block.period_number !== null ? 'period-numeral' : 'period-numeral is-muted'} aria-hidden="true">{blockMark(block)}</span>
                  <input className="admin-bell-block-label" aria-label={`Block ${index + 1} label`} value={block.label} onChange={(event) => updateDraftBlock(index, { label: event.target.value })} />
                  <select className="admin-bell-block-period" aria-label={`${block.label} period`} value={block.period_number ?? ''} onChange={(event) => { const period = event.target.value ? Number(event.target.value) : null; updateDraftBlock(index, { period_number: period, kind: period === null ? 'non_class' : 'class', label: block.label || (period ? `Period ${period}` : 'Activity Period') }) }}><option value="">Named block</option>{Array.from({ length: 9 }, (_, period) => <option value={period + 1} key={period + 1}>Period {period + 1}</option>)}</select>
                  <input className="admin-bell-block-start" aria-label={`${block.label} start time`} type="time" step="60" value={block.start_time} onChange={(event) => updateDraftBlock(index, { start_time: event.target.value })} />
                  <input className="admin-bell-block-end" aria-label={`${block.label} end time`} type="time" step="60" value={block.end_time} onChange={(event) => updateDraftBlock(index, { end_time: event.target.value })} />
                  <span className="admin-bell-block-menu">
                    <AdminRowMenu label={`Actions for ${block.label}`} items={[
                      index > 0 && { label: 'Move up', onSelect: () => moveBlock(index, -1) },
                      index < draft.blocks.length - 1 && { label: 'Move down', onSelect: () => moveBlock(index, 1) },
                      'separator',
                      draft.blocks.length > 1 && { label: 'Remove block', tone: 'danger', onSelect: () => removeBlock(index) },
                    ]} />
                  </span>
                  <span className="admin-bell-block-actions">
                    <button className="icon-button" type="button" aria-label={`Move ${block.label} up`} disabled={index === 0} onClick={() => moveBlock(index, -1)}><ChevronUp aria-hidden="true" /></button>
                    <button className="icon-button" type="button" aria-label={`Move ${block.label} down`} disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ChevronDown aria-hidden="true" /></button>
                    <button className="icon-button" type="button" aria-label={`Remove ${block.label}`} disabled={draft.blocks.length === 1} onClick={() => removeBlock(index)}><Trash2 aria-hidden="true" /></button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {feedbackFor('editor')}
          <div className="form-actions admin-bell-editor-actions">
            <button className="button button-secondary" type="button" onClick={() => { const start = draft.blocks.at(-1)?.end_time ?? '07:28'; setDraft({ ...draft, blocks: [...draft.blocks, { position: draft.blocks.length + 1, kind: 'non_class', label: 'Custom block', period_number: null, start_time: start, end_time: addMinutes(start, 30) }] }) }}><CirclePlus aria-hidden="true" />Add block</button>
            {!draft.is_builtin && draft.id ? <button className="button button-secondary button-danger-outline" type="button" disabled={busy} onClick={() => void archiveDraft()}><Archive aria-hidden="true" />Archive</button> : null}
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void saveDraft()}><Save aria-hidden="true" />Save bell times</button>
          </div>
        </div> : null}
      </section>

      {draft ? <section className="admin-section" aria-labelledby="admin-bell-preview-title">
        <AdminSectionHeading
          id="admin-bell-preview-title"
          level={3}
          title="Homepage preview"
          description="What students see on the homepage at any moment, using the bell times above, including changes you haven’t saved."
        />
        <div className="admin-field-grid admin-bell-preview-controls">
          <div className="field">
            <label htmlFor="admin-bell-preview-date">Date</label>
            <input id="admin-bell-preview-date" aria-label="Preview date" type="date" value={previewDate} onChange={(event) => { if (event.target.value) setPreviewDate(event.target.value) }} />
          </div>
          <div className="field">
            <label htmlFor="admin-bell-preview-time">Time</label>
            <input id="admin-bell-preview-time" aria-label="Preview time" type="time" step="60" value={previewTime} onChange={(event) => { if (event.target.value) setPreviewTime(event.target.value) }} />
          </div>
          <div className="field">
            <label htmlFor="admin-bell-preview-campus">Campus</label>
            <select id="admin-bell-preview-campus" aria-label="Preview campus" value={previewCampus} onChange={(event) => setPreviewCampus(event.target.value as BellCampus)}><option value="NAI">NAI</option><option value="NASH">NASH</option></select>
          </div>
          <div className="field">
            <label htmlFor="admin-bell-preview-day">A/B day</label>
            <select id="admin-bell-preview-day" aria-label="Preview A/B day" value={previewDayType} onChange={(event) => setPreviewDayType(event.target.value as DayType)}><option value="A">A day</option><option value="B">B day</option></select>
          </div>
          <div className="field">
            <label htmlFor="admin-bell-preview-period">Student’s class period</label>
            <select id="admin-bell-preview-period" aria-label="Preview student class period" value={previewPeriod ?? ''} onChange={(event) => setPreviewPeriod(event.target.value ? Number(event.target.value) : null)}><option value="">Empty schedule</option>{Array.from({ length: 9 }, (_, index) => <option value={index + 1} key={index + 1}>Period {index + 1}</option>)}</select>
          </div>
          <div className="field admin-bell-preview-name">
            <label htmlFor="admin-bell-preview-class">Student’s class name</label>
            <input id="admin-bell-preview-class" aria-label="Preview student class name" value={previewClassName} onChange={(event) => setPreviewClassName(event.target.value)} />
          </div>
        </div>
        <label className="checkbox-row admin-bell-preview-closed"><input aria-label="Preview no school" type="checkbox" checked={previewNoSchool} onChange={(event) => setPreviewNoSchool(event.target.checked)} /><span><strong>No school on the preview date</strong><small>Shows what students see on a day off.</small></span></label>

        <div className="panel admin-bell-stage" aria-label={`Homepage preview using ${draft.display_name}`} role="group">
          {previewDay ? <>
            <div className="admin-bell-stage-head">
              <strong>{previewDayLabel}</strong>
              <span className="chip-list">
                {previewBell.isToday && previewDay.day_type ? <span className="chip">{previewDay.day_type} day</span> : null}
                {!previewBell.isToday ? <span className="chip">No school today</span> : null}
                <span className="chip">{previewCampus}</span>
                <span className="chip">{draft.display_name || 'Untitled schedule'}</span>
              </span>
            </div>
            {/* The Balanced homepage shows the same state as one line. It is a
                picture only: inert, so its link to the bell page can't leave
                unsaved bell times behind, and screen readers get the board below. */}
            <div className="admin-bell-stage-layout" inert>
              <p className="admin-bell-stage-label">Balanced homepage</p>
              <NowBoard bell={previewBell} now={previewNow} enrollments={previewEnrollments} nextClass={previewNextClass} variant="strip" />
            </div>
            <div className="admin-bell-stage-layout">
              <p className="admin-bell-stage-label">Bell schedule first homepage</p>
              <div className="admin-bell-stage-grid">
                <NowBoard bell={previewBell} now={previewNow} enrollments={previewEnrollments} nextClass={previewNextClass} variant="hero" />
                <DayTimeline day={previewDay} now={previewNow} enrollments={previewEnrollments} label="Preview bell times" className="admin-bell-stage-timeline" />
              </div>
            </div>
          </> : <p className="empty-inline">No school days fall in the three weeks after this date, so the homepage would say the bell calendar is empty.</p>}
        </div>
      </section> : null}

      {settings ? <section className="admin-section" aria-labelledby="admin-bell-sync-title">
        <AdminSectionHeading
          id="admin-bell-sync-title"
          level={3}
          title="Newsletter sync"
          count={<span className={sourcesVerified ? 'badge badge-success' : 'badge badge-outline'}>{sourcesVerified ? 'Source verified' : 'Not verified yet'}</span>}
          description="Each day the sync reads the newsletter’s public text and asks Gemini, with high thinking and in Eastern time, which A/B day and bell schedule upcoming days use. Gemini’s reasoning is never returned or stored."
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.sync_enabled} onChange={(event) => setSettings({ ...settings, sync_enabled: event.target.checked })} />
          <span><strong>Enable daily detection</strong><small>A database check every five minutes runs the sync once when the daily time arrives.</small></span>
        </label>
        <div className="admin-field-grid">
          <div className="field">
            <label htmlFor="admin-bell-sync-time">Daily time (Eastern)</label>
            <input id="admin-bell-sync-time" type="time" step="60" value={settings.sync_time} onChange={(event) => setSettings({ ...settings, sync_time: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="admin-bell-default">Default schedule</label>
            <select id="admin-bell-default" value={settings.default_schedule_id} onChange={(event) => setSettings({ ...settings, default_schedule_id: event.target.value })}>{activeSchedules.filter((schedule) => schedule.campus_scope === 'BOTH').map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.display_name}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="admin-bell-first-day">First day</label>
            <input id="admin-bell-first-day" type="date" value={settings.school_year_start} onChange={(event) => setSettings({ ...settings, school_year_start: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="admin-bell-semester-two">Semester 2 starts</label>
            <input id="admin-bell-semester-two" type="date" value={settings.semester_2_start} onChange={(event) => setSettings({ ...settings, semester_2_start: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="admin-bell-last-day">Last day</label>
            <input id="admin-bell-last-day" type="date" value={settings.school_year_end} onChange={(event) => setSettings({ ...settings, school_year_end: event.target.value })} />
          </div>
          <div className="field admin-field-wide">
            <label htmlFor="admin-bell-doc">Newsletter Google Doc</label>
            <input id="admin-bell-doc" type="url" inputMode="url" value={settings.newsletter_document_url} onChange={(event) => setSettings({ ...settings, newsletter_document_url: event.target.value })} />
          </div>
        </div>
        {feedbackFor('settings')}
        <div className="admin-bell-sync-actions">
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void saveSettings()}><Save aria-hidden="true" />Save settings</button>
          <div className="form-actions">
            <span className="field-help">Run the sync now:</span>
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void sync(true)}>Preview now</button>
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void sync(false)}>Sync now</button>
          </div>
        </div>
      </section> : null}

      <section className="admin-section" aria-labelledby="admin-bell-history-title">
        <AdminSectionHeading
          id="admin-bell-history-title"
          level={3}
          title="Sync history"
          count={runs.length > 0 ? runs.length.toLocaleString() : undefined}
          description="Evidence from each run. The newest 100 runs are kept and up to 25 are shown here."
        />
        {runs.length === 0 ? <p className="empty-inline">The newsletter sync hasn’t run yet.</p> : <ul className="list admin-disclosure-list">
          {runs.map((run) => (
            <li key={run.id}>
              <details className="admin-disclosure">
                <summary>
                  <span className={runStatus[run.status].badge}>{runStatus[run.status].label}</span>
                  <span className="admin-disclosure-title">
                    <strong>{runTimeFormatter.format(new Date(run.created_at))}</strong>
                    <span className="chip-list">
                      <span className="chip">{runTriggerLabels[run.trigger_type]}</span>
                      <span className="chip">{run.model_id ?? 'No model'}</span>
                    </span>
                  </span>
                  <span className="admin-disclosure-meta numeric">{run.timing_ms === null ? '—' : `${run.timing_ms.toLocaleString()} ms`}</span>
                </summary>
                <div className="admin-disclosure-body">
                  {run.error_message ? <p className="form-error"><AlertCircle aria-hidden="true" />{run.error_message}</p> : null}
                  {([
                    ['Source section', run.source_section ?? 'No source text stored.'],
                    ['Evidence', JSON.stringify(run.evidence, null, 2)],
                    ['Validated extraction', JSON.stringify(run.validated_extraction, null, 2)],
                    ['Applied dates', JSON.stringify(run.applied_dates, null, 2)],
                    ['Preserved or skipped dates', JSON.stringify(run.skipped_dates, null, 2)],
                    ['Raw Gemini JSON', JSON.stringify(run.raw_gemini_json, null, 2)],
                  ] as const).map(([label, value]) => (
                    <section className="admin-code-block" key={label}>
                      <h4>{label}</h4>
                      <pre>{value}</pre>
                    </section>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>}
      </section>
      {dialogs.dialog}
    </div>
  )
}
