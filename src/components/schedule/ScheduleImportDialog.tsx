import { AlertCircle, AlertTriangle, Bug, Check, CheckCircle2, ChevronDown, ClipboardPaste, EyeOff, ImagePlus, ImageUp, Info, PenLine, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useCourseNameSearch, type CourseNameSearchExecutor } from '../../hooks/useCourseNameSearch'
import type { CourseNameSearchResult, CourseTermPolicy, MeetingSlot, ScheduleEnrollment, ScheduleImportModelRecord } from '../../lib/domain'
import { compactMeetingSlotLabels, sameSlot, sortMeetingSlots, termsOverlap } from '../../lib/schedule'
import {
  confirmScheduleImport,
  editableRowsFromImportResult,
  findClassesForCourse,
  importRowError,
  MAX_SCHEDULE_IMAGES,
  prepareScheduleImage,
  reconcileExactClassSelection,
  ScheduleImportRequestError,
  specialCourseKind,
  submitScheduleScreenshots,
  teacherForImportedCourse,
  type EditableScheduleImportRow,
  type ImportClassOption,
  type ScheduleImportResult,
  type ScheduleImportDeveloperDiagnostics,
  type ScheduleImportDeveloperOptions,
} from '../../lib/scheduleImport'
import { adminListScheduleImportModels, getScheduleImportUiSettings } from '../../lib/supabase/data'
import { normalizeTeacherLastName } from '../../lib/teacher'
import { Dialog } from '../ui/Dialog'
import { MeetingSlotGrid } from './MeetingSlotGrid'

interface ImportImage {
  file: File
  previewUrl: string
}

export interface ScheduleImportDialogProps {
  open: boolean
  onboarding?: boolean
  isAdmin?: boolean
  isGuest?: boolean
  initialResult?: ScheduleImportResult | null
  clarificationRowIds?: string[]
  currentEnrollments: ScheduleEnrollment[]
  onClose: () => void
  onImported: (result: { added: number; removed: number }) => Promise<void>
  onGuestPreview?: (result: ScheduleImportResult) => void
  onNeedsClarification?: (clarification: ScheduleImportClarification) => void
  onClarificationChange?: (clarification: ScheduleImportClarification) => void
  onClarificationResolved?: () => void
  importScreenshots?: (files: File[], developerOptions?: ScheduleImportDeveloperOptions) => Promise<ScheduleImportResult>
  searchCourses?: CourseNameSearchExecutor
  loadClassOptions?: (course: CourseNameSearchResult) => Promise<ImportClassOption[]>
  confirmImport?: (rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>
  loadDeveloperModels?: () => Promise<ScheduleImportModelRecord[]>
  loadUiSettings?: () => Promise<{ progress_bar_duration_ms: number }>
  onManualEntry?: () => void
}

export interface ScheduleImportClarification {
  result: ScheduleImportResult
  rowIds: string[]
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp'

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function DeveloperDiagnosticsPanel({ diagnostics }: { diagnostics: ScheduleImportDeveloperDiagnostics }) {
  const blocks: Array<{ label: string; value: unknown }> = [
    { label: 'Exact prompt', value: diagnostics.prompt },
    { label: 'Raw Gemini output', value: diagnostics.raw_gemini_output },
    { label: 'Parsed output', value: diagnostics.parsed_output },
    { label: 'Validation errors', value: diagnostics.validation_errors },
    { label: 'Image metadata', value: diagnostics.image_metadata },
    { label: 'Provider error details', value: diagnostics.provider_error },
  ]
  return <details className="schedule-import-diagnostics" open>
    <summary><Bug aria-hidden="true" />AI developer diagnostics</summary>
    <dl className="facts schedule-import-diagnostics-facts">
      <dt>Model</dt><dd>{diagnostics.model}</dd>
      <dt>Thinking</dt><dd>{diagnostics.thinking_level}</dd>
      <dt>Output limit</dt><dd>{diagnostics.output_token_limit}</dd>
      <dt>Timing</dt><dd>{diagnostics.timing_ms} ms</dd>
      <dt>Temporary log</dt><dd>{diagnostics.diagnostic_log_id ?? 'not stored'}</dd>
    </dl>
    {diagnostics.diagnostic_log_error ? <p className="form-error">Diagnostic log: {diagnostics.diagnostic_log_error}</p> : null}
    {blocks.map((block) => <section key={block.label}><h4>{block.label}</h4><pre>{typeof block.value === 'string' ? block.value : JSON.stringify(block.value, null, 2) ?? 'null'}</pre></section>)}
  </details>
}

function CoursePicker({
  row,
  searchCourses,
  onSelect,
}: {
  row: EditableScheduleImportRow
  searchCourses?: CourseNameSearchExecutor
  onSelect: (course: CourseNameSearchResult) => Promise<void>
}) {
  const inputId = useId()
  const [query, setQuery] = useState(row.course?.name ?? row.source_course_name)
  const [selecting, setSelecting] = useState(false)
  const search = useCourseNameSearch(query, {
    enabled: query.trim().length >= 2,
    ...(searchCourses ? { search: searchCourses } : {}),
  })

  return (
    <div className="schedule-import-course-picker">
      <div className="field">
        <label htmlFor={inputId}>Catalogue course</label>
        <div className="search-input">
          <Search aria-hidden="true" />
          <input
            id={inputId}
            aria-label={`Catalogue course for ${row.source_course_name}`}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search existing courses"
          />
        </div>
        <p className="field-help">The screenshot said “{row.source_course_name}”. Pick the matching course. Imports can’t add new courses to the catalogue.</p>
      </div>
      {search.loading ? <p className="schedule-import-course-status">Searching the catalogue…</p> : null}
      {search.error ? <p className="form-error"><AlertCircle aria-hidden="true" />{search.error}</p> : null}
      {!search.loading && !search.error && query.trim().length >= 2 && search.results.length === 0
        ? <p className="schedule-import-course-status">No catalogue course matches “{query.trim()}”. Try a shorter name or a different word.</p>
        : null}
      <ul className="schedule-import-course-results" aria-live="polite">
        {search.results.slice(0, 5).map((course) => {
          const isSelected = row.course?.id === course.id
          return (
            <li key={course.id}>
              <button
                className={isSelected ? 'schedule-import-course-option is-selected' : 'schedule-import-course-option'}
                aria-pressed={isSelected}
                disabled={selecting}
                onClick={() => {
                  setSelecting(true)
                  setQuery(course.course_name)
                  void onSelect(course).finally(() => setSelecting(false))
                }}
                type="button"
              >
                <span>{course.course_name}</span>
                {isSelected ? <Check aria-hidden="true" /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ImportCourseField({
  row,
  searchCourses,
  onSelect,
}: {
  row: EditableScheduleImportRow
  searchCourses?: CourseNameSearchExecutor
  onSelect: (course: CourseNameSearchResult) => Promise<void>
}) {
  const needsCourse = !row.course || row.flags.some((flag) => flag === 'unresolved_course' || flag === 'ambiguous_course')
  const [editing, setEditing] = useState(needsCourse)

  useEffect(() => {
    if (needsCourse) setEditing(true)
  }, [needsCourse])

  if (row.course && !editing) {
    return <div className="schedule-import-course-summary">
      <span><small>Catalogue course</small><strong>{row.course.name}</strong></span>
      <button className="button button-secondary button-sm" type="button" onClick={() => setEditing(true)}>Change</button>
    </div>
  }

  return <div className="schedule-import-course-editor">
    <CoursePicker row={row} searchCourses={searchCourses} onSelect={async (course) => {
      await onSelect(course)
      setEditing(false)
    }} />
    {row.course && !needsCourse ? <button className="text-button" type="button" onClick={() => setEditing(false)}>Keep {row.course.name}</button> : null}
  </div>
}

function sameSlots(left: MeetingSlot[], right: MeetingSlot[]): boolean {
  const leftSorted = sortMeetingSlots(left)
  const rightSorted = sortMeetingSlots(right)
  return leftSorted.length === rightSorted.length && leftSorted.every((slot, index) => sameSlot(slot, rightSorted[index]))
}

function duplicateImportIndexes(rows: EditableScheduleImportRow[]): Set<number> {
  const duplicates = new Set<number>()
  rows.forEach((left, leftIndex) => {
    if (!left.include || !left.course || left.term === 'unknown') return
    rows.slice(leftIndex + 1).forEach((right, offset) => {
      if (!right.include || right.course?.id !== left.course?.id || right.term !== left.term) return
      if (normalizeTeacherLastName(right.teacher_last_name).toLocaleLowerCase() === normalizeTeacherLastName(left.teacher_last_name).toLocaleLowerCase()
        && sameSlots(right.meeting_slots, left.meeting_slots)) {
        duplicates.add(leftIndex)
        duplicates.add(leftIndex + offset + 1)
      }
    })
  })
  return duplicates
}

function conflictingImportIndexes(rows: EditableScheduleImportRow[]): Set<number> {
  const conflicts = new Set<number>()
  rows.forEach((left, leftIndex) => {
    if (!left.include || left.term === 'unknown') return
    const leftTerm = left.term
    rows.slice(leftIndex + 1).forEach((right, offset) => {
      if (!right.include || right.term === 'unknown' || !termsOverlap(leftTerm, right.term)) return
      const lunchOverlap = rowCoursePolicy(left) === 'lunch' && rowCoursePolicy(right) === 'lunch'
      if (lunchOverlap || left.meeting_slots.some((slot) => right.meeting_slots.some((candidate) => sameSlot(slot, candidate)))) {
        conflicts.add(leftIndex)
        conflicts.add(leftIndex + offset + 1)
      }
    })
  })
  return conflicts
}

function academicTermLabel(term: EditableScheduleImportRow['term']): string {
  if (term === 'semester_1') return 'Semester 1'
  if (term === 'semester_2') return 'Semester 2'
  if (term === 'full_year') return 'Full year'
  return 'Term not set'
}

function classOptionLabel(option: ImportClassOption, courseName?: string): string {
  const periods = compactMeetingSlotLabels(option.meeting_slots).join(' and ')
  const term = academicTermLabel(option.term).toLocaleLowerCase()
  // Lunch and Study Hall sections have no teacher (N/A), so name the section instead.
  const special = specialCourseKind(courseName)
  if (special || normalizeTeacherLastName(option.teacher_last_name).toLocaleUpperCase() === 'N/A') {
    const section = special ?? courseName
    return `Join the existing ${section ? `${section} ` : ''}section, ${periods}, ${term}`
  }
  return `Join ${option.teacher_last_name}’s class, ${periods}, ${term}`
}

function rowCoursePolicy(row: Pick<EditableScheduleImportRow, 'course'>): CourseTermPolicy {
  return row.course?.term_policy ?? 'full_year'
}

function rowNeedsAttention(_row: EditableScheduleImportRow, rowError: string | null, conflict: boolean, duplicate: boolean): boolean {
  return Boolean(rowError)
    || conflict
    || duplicate
}

function clarificationIssueTitle(row: EditableScheduleImportRow, conflict: boolean, duplicate: boolean): string {
  if (conflict) return 'Schedule conflict'
  if (duplicate) return 'Duplicate class'
  if (!row.course || row.flags.includes('unresolved_course')) return 'Course not matched'
  return 'Needs a fix'
}

function clarificationIssue(row: EditableScheduleImportRow, rowError: string | null, conflict: boolean, duplicate: boolean): string {
  if (conflict) return 'This class overlaps another imported class in the same term and period. Choose a different academic term below.'
  if (duplicate) return 'This class duplicates another imported class. Change its details or leave it out.'
  if (rowError) return rowError
  if (!row.course || row.flags.includes('unresolved_course')) return 'Choose the matching course from the catalogue.'
  if (row.flags.includes('ambiguous_course')) return 'Choose the correct catalogue course because the screenshot matched more than one option.'
  if (row.flags.includes('incomplete')) return 'Complete the missing course, teacher, term, or period information.'
  return 'Correct the highlighted schedule error below.'
}

function termIsPrimaryFix(row: EditableScheduleImportRow, rowError: string | null, conflict: boolean): boolean {
  if (rowCoursePolicy(row) === 'full_year') return false
  return conflict || row.term === 'unknown' || Boolean(rowError && /academic term|semester|full year|half-credit|course version/i.test(rowError))
}

function importReviewMessage(result: Pick<ScheduleImportResult, 'retry_count' | 'retry_reasons' | 'warnings'>): string | null {
  const retries = result.retry_count ?? 0
  const retryReason = result.retry_reasons?.filter(Boolean).join(' and ')
  const retryMessage = retries > 0
    ? `The AI was run ${retries === 1 ? 'twice' : `${retries + 1} times`}${retryReason ? ` and ${retryReason}` : ' because some imported details remain unresolved or incomplete'}.`
    : ''
  const warnings = result.warnings.filter((warning) => !/Gemini checked the screenshots again|first reading remained the safer result/i.test(warning))
  return [retryMessage, ...warnings].filter(Boolean).join(' ') || null
}

function ImportedTermField({ row, onChange }: { row: EditableScheduleImportRow; onChange: (term: EditableScheduleImportRow['term']) => void }) {
  const id = useId()
  const policy = rowCoursePolicy(row)
  if (policy === 'full_year') {
    return <div className="field schedule-import-term-field">
      <span className="field-label">Academic term</span>
      <p className="schedule-import-readonly"><strong>Full year</strong></p>
      <p className="field-help">Full-credit and unlisted courses are full year.</p>
    </div>
  }

  const flexible = policy === 'flexible_attendance' || policy === 'sectioned_attendance'
  const label = policy === 'semester'
    ? 'Semester'
    : flexible
      ? 'Full year / Semester'
      : policy === 'variable_credit'
        ? 'Credit and term'
        : policy === 'versioned'
          ? 'Course version format'
          : 'Lunch term'
  return <div className="field schedule-import-term-field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={row.term} aria-invalid={row.term === 'unknown' ? true : undefined} onChange={(event) => onChange(event.target.value as EditableScheduleImportRow['term'])}>
      <option value="unknown">Choose format</option>
      {policy === 'semester' ? null : <option value="full_year">{flexible ? 'Full year, A or B days only' : policy === 'variable_credit' ? 'Full year, 1.0 credit' : policy === 'versioned' ? 'Full-year version' : 'Full year'}</option>}
      <option value="semester_1">{flexible ? 'Semester 1, every day' : policy === 'variable_credit' ? 'Semester 1, 0.5 credit' : 'Semester 1'}</option>
      <option value="semester_2">{flexible ? 'Semester 2, every day' : policy === 'variable_credit' ? 'Semester 2, 0.5 credit' : 'Semester 2'}</option>
    </select>
  </div>
}

export function ScheduleImportDialog({
  open,
  onboarding = false,
  isAdmin = false,
  isGuest = false,
  initialResult = null,
  clarificationRowIds = [],
  onClose,
  onImported,
  onGuestPreview,
  onNeedsClarification,
  onClarificationChange,
  onClarificationResolved,
  importScreenshots = submitScheduleScreenshots,
  searchCourses,
  loadClassOptions = findClassesForCourse,
  confirmImport = confirmScheduleImport,
  loadDeveloperModels = adminListScheduleImportModels,
  loadUiSettings = getScheduleImportUiSettings,
  onManualEntry,
}: ScheduleImportDialogProps) {
  const isClarification = clarificationRowIds.length > 0
  const [images, setImages] = useState<ImportImage[]>([])
  const [rows, setRows] = useState<EditableScheduleImportRow[]>([])
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set())
  // A clarification opens straight into review so the upload step never mounts (and never takes focus).
  const [phase, setPhase] = useState<'upload' | 'processing' | 'review' | 'saving'>(() => initialResult ? 'review' : 'upload')
  const [autoSaving, setAutoSaving] = useState(false)
  /** Classes held back for clarification while the readable ones are auto-saved. */
  const [heldBackCount, setHeldBackCount] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [developerMode, setDeveloperMode] = useState(false)
  const [developerModels, setDeveloperModels] = useState<ScheduleImportModelRecord[]>([])
  const [developerModelId, setDeveloperModelId] = useState('')
  const [developerThinkingLevel, setDeveloperThinkingLevel] = useState<NonNullable<ScheduleImportDeveloperOptions['thinkingLevel']>>('low')
  const [developerData, setDeveloperData] = useState<ScheduleImportDeveloperDiagnostics | null>(null)
  const [developerModelError, setDeveloperModelError] = useState<string | null>(null)
  const [progressDurationMs, setProgressDurationMs] = useState(6500)
  const [resultSummary, setResultSummary] = useState<Omit<ScheduleImportResult, 'rows'>>({ warnings: [], image_count: 0 })
  const imagesRef = useRef(images)
  imagesRef.current = images
  const pickerRef = useRef<HTMLInputElement>(null)
  const chooseButtonRef = useRef<HTMLButtonElement>(null)
  const replaceRefs = useRef<Array<HTMLInputElement | null>>([])
  /**
   * Each analysis gets a run id. Closing or unmounting the dialog moves the id
   * on, so an analysis that finishes afterwards is discarded: it cannot save,
   * preview, or ask for clarification after the student has cancelled.
   */
  const runIdRef = useRef(0)
  const ids = {
    attention: useId(),
    ready: useId(),
    model: useId(),
    reasoning: useId(),
    full: useId(),
  }

  useEffect(() => () => {
    imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
  }, [])

  useEffect(() => {
    if (!open) return
    return () => { runIdRef.current += 1 }
  }, [open])

  // Focus the picker after Dialog's own open effect (a parent's effects run
  // after its children's), so Dialog has already recorded the control that
  // opened it and can return focus there on close. React's autoFocus would
  // run first and make Dialog remember this button instead.
  useEffect(() => {
    // Only on open: later phase changes must not pull focus back to the picker.
    if (open && !initialResult) chooseButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    void loadUiSettings().then((settings) => {
      if (active && Number.isFinite(settings.progress_bar_duration_ms)) {
        setProgressDurationMs(Math.min(30000, Math.max(1000, settings.progress_bar_duration_ms)))
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [loadUiSettings, open])

  useEffect(() => {
    if (!open || !initialResult || rows.length > 0) return
    const editable = editableRowsFromImportResult(initialResult)
    setRows(editable)
    setResultSummary({
      warnings: initialResult.warnings,
      image_count: initialResult.image_count,
      estimated_grade: initialResult.estimated_grade,
      shared_student_count: initialResult.shared_student_count,
      retry_count: initialResult.retry_count,
      retry_reasons: initialResult.retry_reasons,
      developer: initialResult.developer,
    })
    setExpandedRowIds(new Set(editable.filter((row) => clarificationRowIds.includes(row.id) || rowNeedsAttention(row, importRowError(row), false, false)).map((row) => row.id)))
    setMessage(importReviewMessage(initialResult))
    setDeveloperData(initialResult.developer ?? null)
    setPhase('review')
  }, [clarificationRowIds, initialResult, open, rows.length])

  useEffect(() => {
    if (!open || !isClarification || phase !== 'review' || rows.length === 0) return
    onClarificationChange?.({ result: { ...resultSummary, rows }, rowIds: clarificationRowIds })
  }, [clarificationRowIds, isClarification, onClarificationChange, open, phase, resultSummary, rows])

  const addFiles = useCallback(async (incoming: File[], preferredIndex?: number) => {
    setError(null)
    if (incoming.length === 0) return
    if (preferredIndex !== undefined && incoming.length !== 1) {
      setError('Choose one screenshot when replacing an individual image.')
      return
    }
    const available = MAX_SCHEDULE_IMAGES - imagesRef.current.length
    if (preferredIndex === undefined && incoming.length > available) {
      setError(`You can add up to ${MAX_SCHEDULE_IMAGES} screenshots. Remove ${incoming.length - available} ${incoming.length - available === 1 ? 'file' : 'files'} and try again.`)
      return
    }

    try {
      const prepared = await Promise.all(incoming.map(prepareScheduleImage))
      setImages((current) => {
        if (preferredIndex !== undefined) {
          const previous = current[preferredIndex]
          if (!previous) return current
          URL.revokeObjectURL(previous.previewUrl)
          return current.map((item, index) => index === preferredIndex
            ? { file: prepared[0], previewUrl: URL.createObjectURL(prepared[0]) }
            : item)
        }
        if (current.length + prepared.length > MAX_SCHEDULE_IMAGES) {
          setError(`You can add up to ${MAX_SCHEDULE_IMAGES} screenshots.`)
          return current
        }
        return [...current, ...prepared.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The screenshot could not be added.')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onPaste = (event: ClipboardEvent) => {
      const pasted = [...event.clipboardData?.items ?? []]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (pasted.length === 0) return
      event.preventDefault()
      void addFiles(pasted)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles, open])

  useEffect(() => {
    if (!open || !isAdmin || !developerMode || developerModels.length > 0) return
    let active = true
    setDeveloperModelError(null)
    void loadDeveloperModels().then((models) => {
      if (!active) return
      const enabled = models.filter((model) => model.enabled && model.supports_image_input && model.supports_structured_output)
      setDeveloperModels(enabled)
      const selected = enabled.find((model) => model.is_active) ?? enabled[0]
      setDeveloperModelId(selected?.model_id ?? '')
      setDeveloperThinkingLevel(selected?.production_thinking_level ?? selected?.supported_thinking_levels[0] ?? 'low')
    }).catch((caught) => {
      if (active) setDeveloperModelError(caught instanceof Error ? caught.message : 'Could not load enabled Gemini models.')
    })
    return () => { active = false }
  }, [developerMode, developerModels.length, isAdmin, loadDeveloperModels, open])

  function updateRow(index: number, update: Partial<EditableScheduleImportRow>) {
    const rowId = rows[index]?.id
    if (rowId) setExpandedRowIds((expanded) => new Set(expanded).add(rowId))
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? reconcileExactClassSelection({ ...row, ...update }) : row
    )))
  }

  function toggleRow(rowId: string) {
    setExpandedRowIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const duplicateIndexes = useMemo(() => duplicateImportIndexes(rows), [rows])
  const importedConflictIndexes = useMemo(() => conflictingImportIndexes(rows), [rows])
  const rowErrors = rows.map(importRowError)
  const reviewEntries = rows.map((row, index) => {
    const conflict = importedConflictIndexes.has(index)
    const duplicate = duplicateIndexes.has(index)
    const attention = rowNeedsAttention(row, rowErrors[index], conflict, duplicate)
    const priority = conflict ? 0 : duplicate ? 1 : rowErrors[index] ? 2 : attention ? 3 : 4
    return { row, index, conflict, duplicate, attention, priority }
  }).sort((left, right) => left.priority - right.priority || left.index - right.index)
  const visibleReviewEntries = isClarification
    ? reviewEntries.filter(({ row }) => clarificationRowIds.includes(row.id))
    : reviewEntries
  const attentionCount = visibleReviewEntries.filter((entry) => entry.attention).length
  const readyCount = visibleReviewEntries.length - attentionCount
  const includedCount = rows.filter((row) => row.include).length
  const canConfirm = rows.some((row) => row.include)
    && rowErrors.every((rowError) => !rowError)
    && duplicateIndexes.size === 0
    && importedConflictIndexes.size === 0

  function closeDialog() {
    runIdRef.current += 1
    setImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setRows([])
    setExpandedRowIds(new Set())
    setPhase('upload')
    setAutoSaving(false)
    setHeldBackCount(0)
    setError(null)
    setMessage(null)
    setDeveloperMode(false)
    setDeveloperModels([])
    setDeveloperModelId('')
    setDeveloperThinkingLevel('low')
    setDeveloperData(null)
    setDeveloperModelError(null)
    setResultSummary({ warnings: [], image_count: 0 })
    onClose()
  }

  async function processImages() {
    const files = images.map((item) => item.file)
    if (files.length === 0) {
      setError('Add at least one schedule screenshot.')
      return
    }
    const runId = ++runIdRef.current
    const cancelled = () => runId !== runIdRef.current
    setPhase('processing')
    setError(null)
    setMessage(null)
    setDeveloperData(null)
    try {
      const result = isAdmin && developerMode
        ? await importScreenshots(files, {
            enabled: true,
            ...(developerModelId ? { modelId: developerModelId } : {}),
            thinkingLevel: developerThinkingLevel,
          })
        : await importScreenshots(files)
      // The student closed the dialog while the AI was still reading: keep
      // their current schedule and drop this result.
      if (cancelled()) return
      const editable = editableRowsFromImportResult(result)
      setRows(editable)
      setResultSummary({
        warnings: result.warnings,
        image_count: result.image_count,
        estimated_grade: result.estimated_grade,
        shared_student_count: result.shared_student_count,
        retry_count: result.retry_count,
        retry_reasons: result.retry_reasons,
        developer: result.developer,
      })
      setExpandedRowIds(new Set(editable.filter((row) => rowNeedsAttention(row, importRowError(row), false, false)).map((row) => row.id)))
      setMessage(importReviewMessage(result))
      setDeveloperData(result.developer ?? null)
      const duplicates = duplicateImportIndexes(editable)
      const conflicts = conflictingImportIndexes(editable)
      const problemIndexes = new Set<number>()
      editable.forEach((row, index) => {
        if (importRowError(row)
          || duplicates.has(index)
          || conflicts.has(index)) {
          problemIndexes.add(index)
        }
      })
      const canAutoApply = !developerMode && editable.length > 0 && problemIndexes.size === 0
      if (canAutoApply && isGuest) {
        onGuestPreview?.({ ...result, rows: editable })
        closeDialog()
        return
      }
      if (canAutoApply) {
        setPhase('saving')
        setAutoSaving(true)
        try {
          const replacement = await confirmImport(editable)
          await onImported(replacement)
          closeDialog()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'The automatically reviewed schedule could not be saved.')
          setAutoSaving(false)
          setPhase('review')
        }
        return
      }
      if (!developerMode && problemIndexes.size > 0) {
        const partialRows = editable.map((row, index) => problemIndexes.has(index) ? { ...row, include: false } : row)
        const importedCount = partialRows.filter((row) => row.include).length
        try {
          if (importedCount > 0) {
            if (isGuest) {
              onGuestPreview?.({ ...result, rows: partialRows })
            } else {
              setPhase('saving')
              setAutoSaving(true)
              setHeldBackCount(problemIndexes.size)
              const replacement = await confirmImport(partialRows)
              await onImported(replacement)
            }
          }
          onNeedsClarification?.({
            result: { ...result, rows: editable },
            rowIds: [...problemIndexes].map((index) => editable[index].id),
          })
          closeDialog()
          return
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'The valid classes could not be imported automatically.')
          setAutoSaving(false)
          setHeldBackCount(0)
        }
      }
      setPhase('review')
    } catch (caught) {
      if (cancelled()) return
      setError(caught instanceof Error ? caught.message : 'The schedule could not be imported.')
      setDeveloperData(caught instanceof ScheduleImportRequestError ? caught.developer ?? null : null)
      setPhase('upload')
    }
  }

  async function saveRows() {
    if (!canConfirm) return
    if (isGuest) {
      onGuestPreview?.({ ...resultSummary, rows })
      onClarificationResolved?.()
      closeDialog()
      return
    }
    setPhase('saving')
    setError(null)
    try {
      const result = await confirmImport(rows)
      await onImported(result)
      onClarificationResolved?.()
      closeDialog()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reviewed schedule could not be saved.')
      setPhase('review')
    }
  }

  function removeImage(index: number) {
    setImages((current) => {
      const removed = current[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((_, candidateIndex) => candidateIndex !== index)
    })
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void addFiles([...event.dataTransfer.files])
  }

  if (!open) return null

  const inUploadStep = phase === 'upload' || phase === 'processing' || autoSaving
  const busy = phase === 'processing' || autoSaving
  const imageWord = images.length <= 1 ? 'screenshot' : 'screenshots'
  const full = images.length >= MAX_SCHEDULE_IMAGES
  const saving = phase === 'saving'

  const title = isClarification
    ? `Fix ${clarificationRowIds.length} ${clarificationRowIds.length === 1 ? 'class' : 'classes'}`
    : inUploadStep ? 'Import your schedule' : 'Review your classes'
  const description = isClarification
    ? 'Any classes we could read are already in your schedule. Fix or leave out each class below.'
    : inUploadStep
      ? 'Add a screenshot of your schedule and ScheduleShare will find your classes.'
      : isGuest
        ? 'Check the classes we found. Create an account when you’re ready to save them.'
        : 'Courses must match the catalogue. Conflicts are checked for each semester and A/B day.'

  const errorNotice = error ? (
    <div className="notice notice-danger schedule-import-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <p>{error}</p>
    </div>
  ) : null

  const footer = inUploadStep ? (
    <>
      <p className="schedule-import-footer-note">
        {autoSaving ? 'Saving your classes…' : phase === 'processing' ? 'Closing now cancels the import. Nothing has been saved yet.' : images.length === 0 ? `Add up to ${MAX_SCHEDULE_IMAGES} screenshots.` : images.length === 1 ? 'Ready to analyze.' : `All ${images.length} screenshots are read together.`}
      </p>
      <button className="button button-primary" disabled={busy || images.length === 0 || (developerMode && Boolean(developerModelError))} type="button" onClick={() => void processImages()}>
        {autoSaving ? 'Saving…' : busy ? `Analyzing ${imageWord}…` : `Analyze ${imageWord}`}
      </button>
    </>
  ) : (
    <>
      <p className="schedule-import-footer-note">
        <strong>{includedCount}</strong> {includedCount === 1 ? 'class' : 'classes'} selected.{isGuest ? '' : ' Saving replaces your current schedule.'}
      </p>
      {isClarification ? null : <button className="button button-secondary" type="button" onClick={() => setPhase('upload')} disabled={saving}>Back to screenshots</button>}
      <button className="button button-primary" disabled={!canConfirm || saving} type="button" onClick={() => void saveRows()}>
        {saving ? 'Saving…' : isClarification ? (isGuest ? 'Show corrected schedule' : 'Save clarifications') : isGuest ? 'Show imported schedule' : 'Replace schedule'}
      </button>
    </>
  )

  function renderRow({ row, index, conflict, duplicate, attention }: typeof reviewEntries[number]) {
    const expanded = expandedRowIds.has(row.id)
    const rowError = rowErrors[index]
    const primaryTermFix = termIsPrimaryFix(row, rowError, conflict)
    const hasError = Boolean(rowError) || conflict || duplicate
    const periods = [...new Set(row.meeting_slots.map((slot) => slot.period_number))].sort((left, right) => left - right)
    const slotLabels = compactMeetingSlotLabels(row.meeting_slots)
    const teacher = teacherForImportedCourse(row.teacher_last_name, row.course?.name)
    const special = specialCourseKind(row.course?.name)
    const detailsId = `schedule-import-row-${row.id}`

    const editor = (
      <div className="schedule-import-editor">
        <label className="checkbox-row schedule-import-include">
          <input type="checkbox" checked={row.include} onChange={(event) => updateRow(index, { include: event.target.checked })} />
          <span><strong>Include this class</strong><small>Uncheck to leave it out of your imported schedule.</small></span>
        </label>
        <div className="schedule-import-fields">
          <div className="schedule-import-field-wide">
            <ImportCourseField row={row} searchCourses={searchCourses} onSelect={async (course) => {
              const options = await loadClassOptions(course)
              const policy = course.course_term_policy ?? 'full_year'
              updateRow(index, {
                course: { id: course.id, name: course.course_name, confidence: 1, term_policy: policy },
                term: policy === 'full_year' ? 'full_year' : row.term === 'full_year' ? 'unknown' : row.term,
                teacher_last_name: teacherForImportedCourse(row.teacher_last_name, course.course_name),
                class_options: options,
                flags: row.flags.filter((flag) => flag !== 'unresolved_course'),
              })
            }} />
          </div>
          {special ? null : <TeacherField value={teacher} disabled={Boolean(special)} onChange={(value) => updateRow(index, { teacher_last_name: value })} />}
          {primaryTermFix ? null : <ImportedTermField row={row} onChange={(term) => updateRow(index, { term })} />}
          <ClassChoiceField row={row} onChange={(classId) => {
            const option = row.class_options.find((candidate) => candidate.id === classId)
            updateRow(index, option ? {
              selected_existing_class_id: option.id,
              teacher_last_name: option.teacher_last_name,
              term: option.term,
              meeting_slots: option.meeting_slots,
              resolution: 'existing_class',
            } : { selected_existing_class_id: null })
          }} />
        </div>
        <details className="schedule-import-slots">
          <summary>
            <span>Edit meeting slots</span>
            <span className="chip-list">{slotLabels.length ? slotLabels.map((label) => <span className="chip" key={label}>{label}</span>) : <span className="chip">None selected</span>}</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <MeetingSlotGrid meetingSlots={row.meeting_slots} onChange={(meetingSlots) => updateRow(index, { meeting_slots: meetingSlots })} />
        </details>
        {row.warnings.length ? <p className="notice notice-warning schedule-import-row-warning"><AlertTriangle aria-hidden="true" /><span>{row.warnings.join(' ')}</span></p> : null}
        {row.confidence < 0.9 ? <p className="schedule-import-confidence">AI confidence: {Math.round(row.confidence * 100)}%</p> : null}
      </div>
    )

    return (
      <li className={['schedule-import-row', hasError ? 'has-error' : attention ? 'needs-attention' : '', expanded ? 'is-expanded' : '', row.include ? '' : 'is-excluded'].filter(Boolean).join(' ')} key={row.id}>
        <button
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          className="schedule-import-row-toggle"
          type="button"
          onClick={() => toggleRow(row.id)}
        >
          <span className={periods.length ? 'period-numeral' : 'period-numeral is-muted'} aria-hidden="true">{periods[0] ?? '?'}</span>
          <span className="schedule-import-row-main">
            <strong>{row.course?.name ?? row.source_course_name}</strong>
            <span className="schedule-import-row-meta">
              {special ? null : <span className={teacher ? '' : 'is-missing'}>{teacher || 'Teacher not found'}</span>}
              <span className="chip-list">
                <span className={row.term === 'unknown' ? 'chip is-missing' : 'chip'}>{academicTermLabel(row.term)}</span>
                {slotLabels.length ? slotLabels.map((label) => <span className="chip" key={label}>{label}</span>) : <span className="chip is-missing">No periods</span>}
              </span>
              <span className="schedule-import-row-action">{row.selected_existing_class_id ? 'Joins existing class' : row.course ? 'Creates new class' : 'Needs a course'}</span>
            </span>
            <RowFlags row={row} rowError={rowError} conflict={conflict} duplicate={duplicate} />
          </span>
          <ChevronDown aria-hidden="true" className="schedule-import-row-chevron" />
        </button>
        {isClarification ? (
          <div className={attention ? 'schedule-import-issue' : 'schedule-import-issue is-resolved'} role="status">
            {attention ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            {attention
              ? <p><strong>{clarificationIssueTitle(row, conflict, duplicate)}</strong> {clarificationIssue(row, rowError, conflict, duplicate)}</p>
              : <p><strong>Fixed</strong> {row.include ? 'This class is ready to save.' : 'This class will be left out.'}</p>}
          </div>
        ) : null}
        {expanded ? <div className="schedule-import-row-details" id={detailsId}>
          {primaryTermFix ? <section className="schedule-import-term-fix" aria-label="Suggested fix">
            <div>
              <strong>Choose the academic term</strong>
              <p>Put this class in the semester where the period is free.</p>
            </div>
            <ImportedTermField row={row} onChange={(term) => updateRow(index, { term })} />
          </section> : null}
          {primaryTermFix ? (
            <details className="schedule-import-more">
              <summary><span>Other ways to fix this class</span><ChevronDown aria-hidden="true" /></summary>
              {editor}
            </details>
          ) : editor}
          {rowError && !isClarification ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{rowError}</p> : null}
          {conflict && !isClarification ? <p className="form-error"><AlertCircle aria-hidden="true" />This class still overlaps another included class. Choose another term, edit its meeting slots, or leave it out.</p> : null}
          {duplicate && !isClarification ? <p className="form-error"><AlertCircle aria-hidden="true" />These details duplicate another included class.</p> : null}
        </div> : null}
      </li>
    )
  }

  const attentionEntries = visibleReviewEntries.filter((entry) => entry.attention)
  const readyEntries = visibleReviewEntries.filter((entry) => !entry.attention)

  return (
    <Dialog
      title={title}
      description={description}
      onClose={closeDialog}
      dismissible={!saving}
      size="large"
      className={inUploadStep ? 'schedule-import-dialog is-upload' : 'schedule-import-dialog is-review'}
      closeLabel={isClarification ? 'Close clarification dialog' : 'Close import dialog'}
      footer={footer}
    >
      {inUploadStep ? (
        <>
          {onboarding ? (
            <ol className="schedule-import-steps" aria-label="Schedule import steps">
              <li aria-current="step">Screenshot</li>
              <li>Review classes</li>
              <li>Find classmates</li>
            </ol>
          ) : null}

          {busy ? (
            <div className="schedule-import-progress" role="status" aria-live="polite">
              <span className="schedule-import-progress-icon" aria-hidden="true"><ImageUp /></span>
              <div className="schedule-import-progress-text">
                <strong>{autoSaving ? 'Saving your classes…' : 'Analyzing your screenshots…'}</strong>
                <p>{autoSaving
                  ? heldBackCount > 0
                    ? `Saving the classes we could read. We’ll ask you about ${heldBackCount === 1 ? 'the other class' : `the other ${heldBackCount} classes`} next.`
                    : 'Everything matched, so your schedule is being saved now.'
                  : 'AI is finding each class, its semester, and its A/B-day periods.'}</p>
              </div>
              <div
                className={autoSaving ? 'schedule-import-progress-track is-indeterminate' : 'schedule-import-progress-track'}
                role="progressbar"
                aria-label={autoSaving ? 'Saving imported classes' : 'AI screenshot analysis progress'}
                style={{ '--schedule-import-progress-duration': `${progressDurationMs}ms` } as CSSProperties}
              >
                <span />
              </div>
            </div>
          ) : (
            <div
              className={['schedule-import-drop', images.length > 0 ? 'has-images' : '', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
              onDragOver={(event) => { event.preventDefault(); if (!dragging) setDragging(true) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
              onDrop={onDrop}
            >
              <span className="schedule-import-drop-icon" aria-hidden="true"><ImageUp /></span>
              <div className="schedule-import-drop-text">
                {full ? (
                  <>
                    <strong>You’ve added all {MAX_SCHEDULE_IMAGES} screenshots</strong>
                    <span id={ids.full}>That’s the most one import can read. Replace or remove one below to use a different screenshot.</span>
                  </>
                ) : (
                  <>
                    <strong className="schedule-import-desktop-only">{images.length > 0 ? 'Drop, paste, or choose another screenshot' : 'Drop, paste, or choose schedule screenshots'}</strong>
                    <strong className="schedule-import-mobile-only">{images.length > 0 ? 'Add another screenshot' : 'Add a clear screenshot of your schedule'}</strong>
                    <span>PNG, JPEG, or WebP, up to 10 MB each</span>
                  </>
                )}
              </div>
              <button
                className={images.length > 0 ? 'button button-secondary' : 'button button-primary'}
                ref={chooseButtonRef}
                type="button"
                // aria-disabled, not disabled: the button keeps focus after the
                // third screenshot is chosen, and its description says why.
                aria-disabled={full || undefined}
                aria-describedby={full ? ids.full : undefined}
                onClick={() => { if (!full) pickerRef.current?.click() }}
              >
                <ImagePlus aria-hidden="true" />
                {images.length > 0 ? 'Add screenshot' : 'Choose screenshot'}
              </button>
              <input
                ref={pickerRef}
                accept={ACCEPTED_IMAGE_TYPES}
                aria-label="Choose schedule screenshots"
                hidden
                multiple
                type="file"
                onChange={(event) => { void addFiles([...event.target.files ?? []]); event.target.value = '' }}
              />
              {images.length === 0 ? <p className="schedule-import-drop-hint schedule-import-desktop-only"><ClipboardPaste aria-hidden="true" />Add up to three at once, or paste with Ctrl+V or Cmd+V.</p> : null}
            </div>
          )}

          {errorNotice}

          {images.length > 0 ? (
            <section className="schedule-import-images" aria-label="Screenshots to analyze">
              <p className="schedule-import-image-count" aria-live="polite"><strong>{images.length} of {MAX_SCHEDULE_IMAGES}</strong> {images.length === 1 ? 'screenshot' : 'screenshots'} added</p>
              <ul className={busy ? 'schedule-import-image-list is-busy' : 'schedule-import-image-list'}>
                {images.map((image, index) => (
                  <li className="schedule-import-image" key={image.previewUrl}>
                    <span className="schedule-import-image-frame"><img src={image.previewUrl} alt={`Schedule screenshot ${index + 1} preview`} /></span>
                    <div className="schedule-import-image-meta">
                      <span className="schedule-import-image-name" title={image.file.name}>{image.file.name}</span>
                      <span className="schedule-import-image-size">{formatFileSize(image.file.size)}</span>
                    </div>
                    <div className="schedule-import-image-actions">
                      <button className="button button-ghost button-sm" type="button" disabled={busy} aria-label={`Replace ${image.file.name}`} onClick={() => replaceRefs.current[index]?.click()}>Replace</button>
                      <input
                        ref={(element) => { replaceRefs.current[index] = element }}
                        accept={ACCEPTED_IMAGE_TYPES}
                        aria-label={`Replace screenshot ${index + 1}`}
                        hidden
                        type="file"
                        onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFiles([file], index); event.target.value = '' }}
                      />
                      <button className="button button-ghost button-sm button-danger-outline" type="button" disabled={busy} aria-label={`Remove ${image.file.name}`} onClick={() => removeImage(index)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {busy ? null : (
            <p className="notice schedule-import-privacy"><EyeOff aria-hidden="true" /><span>Crop out your name and student ID first. You can add up to three screenshots.</span></p>
          )}

          {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}

          {onboarding && !busy ? (
            <div className="schedule-import-alternatives">
              <p>No screenshot handy?</p>
              <button className="button button-secondary" type="button" onClick={() => { closeDialog(); onManualEntry?.() }}><PenLine aria-hidden="true" />Enter schedule manually</button>
              <button className="text-button" type="button" onClick={closeDialog}>I’ll do this later</button>
            </div>
          ) : null}

          {isAdmin && !busy ? (
            <section className="schedule-import-developer" aria-label="AI developer mode">
              <label className="checkbox-row">
                <input type="checkbox" checked={developerMode} onChange={(event) => { setDeveloperMode(event.target.checked); setDeveloperData(null) }} />
                <span><strong>AI developer mode</strong><small>Current admin session only. Bypasses only ScheduleShare’s import rate limit and stores temporary diagnostics.</small></span>
              </label>
              {developerMode ? <div className="field-row">
                <div className="field">
                  <label htmlFor={ids.model}>Test model</label>
                  <select id={ids.model} value={developerModelId} disabled={developerModels.length === 0} onChange={(event) => {
                    const model = developerModels.find((candidate) => candidate.model_id === event.target.value)
                    setDeveloperModelId(event.target.value)
                    if (model && (!developerThinkingLevel || !model.supported_thinking_levels.includes(developerThinkingLevel))) {
                      setDeveloperThinkingLevel(model.supported_thinking_levels.includes('low') ? 'low' : model.supported_thinking_levels[0] ?? 'low')
                    }
                  }}>{developerModels.map((model) => <option key={model.model_id} value={model.model_id}>{model.display_name}{model.is_active ? ' (production)' : ''}</option>)}</select>
                </div>
                <div className="field">
                  <label htmlFor={ids.reasoning}>Reasoning</label>
                  <select id={ids.reasoning} value={developerThinkingLevel} disabled={!developerModelId} onChange={(event) => setDeveloperThinkingLevel(event.target.value as NonNullable<ScheduleImportDeveloperOptions['thinkingLevel']>)}>{(developerModels.find((model) => model.model_id === developerModelId)?.supported_thinking_levels ?? []).map((level) => <option value={level} key={level}>{level}</option>)}</select>
                </div>
              </div> : null}
              {developerModelError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{developerModelError}</p> : null}
            </section>
          ) : null}
        </>
      ) : (
        <>
          {message ? <div className="notice notice-info schedule-import-message"><Info aria-hidden="true" /><p>{message}</p></div> : null}
          {errorNotice}
          {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}
          {isClarification ? (
            <ul className="schedule-import-rows" aria-label="Classes to fix">{visibleReviewEntries.map(renderRow)}</ul>
          ) : (
            <>
              <div className="schedule-import-review-bar" aria-label="Review row display controls" role="group">
                <p className="schedule-import-review-counts">
                  <span className={attentionCount > 0 ? 'badge badge-danger' : 'badge'}>{attentionCount} {attentionCount === 1 ? 'needs' : 'need'} attention</span>
                  <span className="badge badge-success">{readyCount} ready</span>
                </p>
                <div className="schedule-import-review-toggles">
                  <button className="text-button" type="button" onClick={() => setExpandedRowIds(new Set(rows.map((row) => row.id)))}>Expand all</button>
                  <button className="text-button" type="button" onClick={() => setExpandedRowIds(new Set())}>Collapse all</button>
                </div>
              </div>
              {attentionEntries.length > 0 ? (
                <section className="schedule-import-group" aria-labelledby={ids.attention}>
                  <div className="schedule-import-group-header"><h3 id={ids.attention}>Needs attention</h3><p>Fix these first.</p></div>
                  <ul className="schedule-import-rows">{attentionEntries.map(renderRow)}</ul>
                </section>
              ) : null}
              {readyEntries.length > 0 ? (
                <section className="schedule-import-group" aria-labelledby={ids.ready}>
                  <div className="schedule-import-group-header"><h3 id={ids.ready}>Ready</h3><p>Open a class only if something looks wrong.</p></div>
                  <ul className="schedule-import-rows">{readyEntries.map(renderRow)}</ul>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </Dialog>
  )
}

function RowFlags({ row, rowError, conflict, duplicate }: { row: EditableScheduleImportRow; rowError: string | null; conflict: boolean; duplicate: boolean }) {
  const flags: Array<{ label: string; danger?: boolean }> = []
  if (row.flags.includes('low_confidence')) flags.push({ label: 'Low confidence' })
  if (row.flags.includes('duplicate')) flags.push({ label: 'Overlap merged' })
  if (row.flags.includes('unresolved_course')) flags.push({ label: 'Course unresolved', danger: true })
  if (row.flags.includes('ambiguous_course')) flags.push({ label: 'Ambiguous match' })
  if (row.flags.includes('incomplete')) flags.push({ label: 'Incomplete', danger: true })
  if (rowError && !flags.some((flag) => flag.danger)) flags.push({ label: 'Needs a fix', danger: true })
  if (conflict) flags.push({ label: 'Schedule conflict', danger: true })
  if (duplicate) flags.push({ label: 'Duplicate class', danger: true })
  if (!row.include) flags.push({ label: 'Left out' })
  if (flags.length === 0) return null
  return <span className="schedule-import-flags">{flags.map((flag) => <span className={flag.danger ? 'badge badge-danger' : 'badge badge-outline'} key={flag.label}>{flag.label}</span>)}</span>
}

function TeacherField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>Teacher last name</label>
      <input id={id} autoComplete="off" value={value} disabled={disabled} maxLength={120} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function ClassChoiceField({ row, onChange }: { row: EditableScheduleImportRow; onChange: (classId: string | null) => void }) {
  const id = useId()
  const helpId = useId()
  return (
    <div className="field">
      <label htmlFor={id}>Class to join</label>
      <select id={id} value={row.selected_existing_class_id ?? ''} disabled={!row.course} aria-describedby={helpId} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Create a new class for this course</option>
        {row.class_options.map((option) => <option value={option.id} key={option.id}>{classOptionLabel(option, row.course?.name)}</option>)}
      </select>
      <p id={helpId} className="field-help">{row.class_options.length > 0 ? 'Joining an existing class shows you who else is in it.' : row.course ? 'Nobody has added this class yet, so a new one will be created.' : 'Choose a course first.'}</p>
    </div>
  )
}
