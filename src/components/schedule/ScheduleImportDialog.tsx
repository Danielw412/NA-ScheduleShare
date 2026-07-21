import { AlertTriangle, Bug, CheckCircle2, ChevronDown, ClipboardPaste, FileImage, Sparkles, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useCourseNameSearch, type CourseNameSearchExecutor } from '../../hooks/useCourseNameSearch'
import type { CourseNameSearchResult, MeetingSlot, ScheduleEnrollment, ScheduleImportModelRecord } from '../../lib/domain'
import { formatMeetingSlotSummary, hasMultiplePeriodsOnAnyDay, sameSlot, sortMeetingSlots, termsOverlap } from '../../lib/schedule'
import {
  confirmScheduleImport,
  findClassesForCourse,
  importClassOptionLabel,
  importRowError,
  MAX_SCHEDULE_IMAGES,
  normalizeReviewTerm,
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
  currentEnrollments: ScheduleEnrollment[]
  onClose: () => void
  onImported: (result: { added: number; removed: number }) => Promise<void>
  onRequireAccount?: (result: ScheduleImportResult) => void
  importScreenshots?: (files: File[], developerOptions?: ScheduleImportDeveloperOptions) => Promise<ScheduleImportResult>
  searchCourses?: CourseNameSearchExecutor
  loadClassOptions?: (course: CourseNameSearchResult) => Promise<ImportClassOption[]>
  confirmImport?: (rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>
  loadDeveloperModels?: () => Promise<ScheduleImportModelRecord[]>
  loadUiSettings?: () => Promise<{ progress_bar_duration_ms: number }>
  onManualEntry?: () => void
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
  return <details className="import-developer-results" open>
    <summary><Bug size={16} aria-hidden="true" /> AI developer diagnostics</summary>
    <div className="import-developer-summary">
      <span><strong>Model</strong>{diagnostics.model}</span>
      <span><strong>Thinking</strong>{diagnostics.thinking_level}</span>
      <span><strong>Output limit</strong>{diagnostics.output_token_limit}</span>
      <span><strong>Timing</strong>{diagnostics.timing_ms} ms</span>
      <span><strong>Temporary log</strong>{diagnostics.diagnostic_log_id ?? 'not stored'}</span>
    </div>
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
  const [query, setQuery] = useState(row.course?.name ?? row.source_course_name)
  const [selecting, setSelecting] = useState(false)
  const search = useCourseNameSearch(query, {
    enabled: query.trim().length >= 2,
    ...(searchCourses ? { search: searchCourses } : {}),
  })

  return (
    <div className="import-course-picker">
      <label>Catalogue course
        <input
          aria-label={`Catalogue course for ${row.source_course_name}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search existing courses"
        />
      </label>
      {search.loading ? <small className="muted">Searching catalogue…</small> : null}
      {search.error ? <small className="form-error">{search.error}</small> : null}
      <div className="import-course-results" aria-live="polite">
        {search.results.slice(0, 5).map((course) => (
          <button
            className={row.course?.id === course.id ? 'is-selected' : ''}
            disabled={selecting}
            key={course.id}
            onClick={() => {
              setSelecting(true)
              setQuery(course.course_name)
              void onSelect(course).finally(() => setSelecting(false))
            }}
            type="button"
          >
            {course.course_name}
          </button>
        ))}
      </div>
      {row.course ? <p className="selected-course-name">Selected existing course: <strong>{row.course.name}</strong></p> : (
        <p className="form-error">Select an existing course. The importer cannot create catalogue entries.</p>
      )}
    </div>
  )
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
      if (left.meeting_slots.some((slot) => right.meeting_slots.some((candidate) => sameSlot(slot, candidate)))) {
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
  return 'Full Year'
}

function rowNeedsAttention(row: EditableScheduleImportRow, rowError: string | null, conflict: boolean, duplicate: boolean): boolean {
  return Boolean(rowError)
    || conflict
    || duplicate
    || row.confidence < 0.9
    || row.flags.some((flag) => ['low_confidence', 'unresolved_course', 'ambiguous_course', 'incomplete'].includes(flag))
}

export function ScheduleImportDialog({
  open,
  onboarding = false,
  isAdmin = false,
  isGuest = false,
  initialResult = null,
  currentEnrollments,
  onClose,
  onImported,
  onRequireAccount,
  importScreenshots = submitScheduleScreenshots,
  searchCourses,
  loadClassOptions = findClassesForCourse,
  confirmImport = confirmScheduleImport,
  loadDeveloperModels = adminListScheduleImportModels,
  loadUiSettings = getScheduleImportUiSettings,
  onManualEntry,
}: ScheduleImportDialogProps) {
  const [images, setImages] = useState<ImportImage[]>([])
  const [rows, setRows] = useState<EditableScheduleImportRow[]>([])
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'upload' | 'processing' | 'review' | 'saving'>('upload')
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

  useEffect(() => () => {
    imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
  }, [])

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
    const editable = initialResult.rows.map((row) => ({
      ...row,
      term: normalizeReviewTerm(row.term),
      selected_existing_class_id: row.existing_class_id,
      include: true,
    })).map(reconcileExactClassSelection)
    setRows(editable)
    setResultSummary({
      warnings: initialResult.warnings,
      image_count: initialResult.image_count,
      estimated_grade: initialResult.estimated_grade,
      shared_student_count: initialResult.shared_student_count,
      developer: initialResult.developer,
    })
    setExpandedRowIds(new Set(editable.filter((row) => rowNeedsAttention(row, importRowError(row), false, false)).map((row) => row.id)))
    setMessage(initialResult.warnings.join(' '))
    setDeveloperData(initialResult.developer ?? null)
    setPhase('review')
  }, [initialResult, open, rows.length])

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

  const duplicateIndexes = useMemo(() => duplicateImportIndexes(rows), [rows])
  const importedConflictIndexes = useMemo(() => conflictingImportIndexes(rows), [rows])
  const existingClassCount = currentEnrollments.filter((enrollment) => enrollment.active).length
  const existingClassNoun = existingClassCount === 1 ? 'class' : 'classes'
  const rowErrors = rows.map(importRowError)
  const canConfirm = rows.some((row) => row.include)
    && rowErrors.every((rowError) => !rowError)
    && duplicateIndexes.size === 0
    && importedConflictIndexes.size === 0

  function closeDialog() {
    setImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setRows([])
    setExpandedRowIds(new Set())
    setPhase('upload')
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
      const editable = result.rows.map((row) => ({
        ...row,
        term: normalizeReviewTerm(row.term),
        selected_existing_class_id: row.existing_class_id,
        include: true,
      })).map(reconcileExactClassSelection)
      setRows(editable)
      setResultSummary({
        warnings: result.warnings,
        image_count: result.image_count,
        estimated_grade: result.estimated_grade,
        shared_student_count: result.shared_student_count,
        developer: result.developer,
      })
      setExpandedRowIds(new Set(editable.filter((row) => rowNeedsAttention(row, importRowError(row), false, false)).map((row) => row.id)))
      setMessage(result.warnings.join(' '))
      setDeveloperData(result.developer ?? null)
      const canAutoReplace = !isGuest
        && !developerMode
        && editable.length > 0
        && editable.every((row) => row.confidence > 0.8 && !importRowError(row))
        && editable.every((row) => !row.flags.some((flag) => ['low_confidence', 'unresolved_course', 'ambiguous_course', 'incomplete'].includes(flag)))
        && duplicateImportIndexes(editable).size === 0
        && conflictingImportIndexes(editable).size === 0
      if (canAutoReplace) {
        setPhase('saving')
        try {
          const replacement = await confirmImport(editable)
          await onImported(replacement)
          closeDialog()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'The automatically reviewed schedule could not be saved.')
          setPhase('review')
        }
        return
      }
      setPhase('review')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The schedule could not be imported.')
      setDeveloperData(caught instanceof ScheduleImportRequestError ? caught.developer ?? null : null)
      setPhase('upload')
    }
  }

  async function saveRows() {
    if (!canConfirm) return
    if (isGuest) {
      onRequireAccount?.({ ...resultSummary, rows })
      return
    }
    setPhase('saving')
    setError(null)
    try {
      const result = await confirmImport(rows)
      await onImported(result)
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
    void addFiles([...event.dataTransfer.files])
  }

  if (!open) return null
  return createPortal(
    <div className="dialog-backdrop import-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== 'saving') closeDialog() }}>
      <section className="class-dialog schedule-import-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-import-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <div>
            <h2 id="schedule-import-title">Import your schedule</h2>
            <p>Choose a screenshot and ScheduleShare will identify your classes.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close import dialog" onClick={closeDialog} disabled={phase === 'saving'}><X aria-hidden="true" /></button>
        </header>

        {phase === 'upload' || phase === 'processing' ? (
          <div className="import-upload-step">
            {onboarding ? <div className="import-onboarding-flow" aria-label="Schedule import steps"><span>Screenshot</span><strong>→</strong><span>Review classes</span><strong>→</strong><span>Find classmates</span></div> : null}
            <div className="import-privacy-note"><Sparkles aria-hidden="true" /><p><span>Crop out your name and student ID. You can add up to three screenshots if needed.</span></p></div>
            {isAdmin ? <section className="import-developer-controls">
              <label className="checkbox-row"><input type="checkbox" checked={developerMode} onChange={(event) => { setDeveloperMode(event.target.checked); setDeveloperData(null) }} /><span><strong>AI developer mode</strong><small>Current admin session only. Bypasses only ScheduleShare's import rate limit and stores temporary diagnostics.</small></span></label>
              {developerMode ? <div className="two-field-row">
                <label>Test model<select value={developerModelId} disabled={developerModels.length === 0} onChange={(event) => {
                  const model = developerModels.find((candidate) => candidate.model_id === event.target.value)
                  setDeveloperModelId(event.target.value)
                  if (model && (!developerThinkingLevel || !model.supported_thinking_levels.includes(developerThinkingLevel))) {
                    setDeveloperThinkingLevel(model.supported_thinking_levels.includes('low') ? 'low' : model.supported_thinking_levels[0] ?? 'low')
                  }
                }}>{developerModels.map((model) => <option key={model.model_id} value={model.model_id}>{model.display_name}{model.is_active ? ' (production)' : ''}</option>)}</select></label>
                <label>Reasoning<select value={developerThinkingLevel} disabled={!developerModelId} onChange={(event) => setDeveloperThinkingLevel(event.target.value as NonNullable<ScheduleImportDeveloperOptions['thinkingLevel']>)}>{(developerModels.find((model) => model.model_id === developerModelId)?.supported_thinking_levels ?? []).map((level) => <option value={level} key={level}>{level}</option>)}</select></label>
              </div> : null}
              {developerModelError ? <p className="form-error" role="alert">{developerModelError}</p> : null}
            </section> : null}
            <div className={images.length > 0 ? 'import-drop-zone has-images' : 'import-drop-zone'} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
              <Upload aria-hidden="true" />
              <strong className="desktop-import-instructions">Drop, paste, or choose schedule screenshots</strong>
              <strong className="mobile-import-instructions">Add a clear screenshot of your schedule</strong>
              <span>PNG, JPEG, or WebP · 10 MB maximum each</span>
              <div className="import-upload-actions">
                <label className="button button-primary">
                  {images.length > 0 ? 'Add screenshot' : 'Choose screenshot'}
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Choose schedule screenshots"
                    hidden
                    multiple
                    type="file"
                    onChange={(event) => { void addFiles([...event.target.files ?? []]); event.target.value = '' }}
                  />
                </label>
              </div>
              <small className="desktop-import-instructions"><ClipboardPaste size={15} aria-hidden="true" /> Select or drop up to three together, or press Ctrl+V / Cmd+V to paste.</small>
            </div>
            {images.length > 0 ? <p className="import-image-count" aria-live="polite"><strong>{images.length} of {MAX_SCHEDULE_IMAGES}</strong> {images.length === 1 ? 'screenshot' : 'screenshots'} added</p> : null}
            {images.length > 0 ? <div className="import-image-grid">
              {images.map((image, index) => <article className="import-image-slot" key={image.previewUrl}>
                <img src={image.previewUrl} alt={`Schedule screenshot ${index + 1} preview`} />
                <span title={image.file.name}>{image.file.name}</span>
                <div>
                  <label className="button button-secondary">Replace<input accept="image/png,image/jpeg,image/webp" aria-label={`Replace screenshot ${index + 1}`} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFiles([file], index); event.target.value = '' }} /></label>
                  <button type="button" onClick={() => removeImage(index)}>Remove</button>
                </div>
              </article>)}
            </div> : null}
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}
            {phase === 'processing' ? <div className="import-progress" role="status" aria-live="polite"><div><strong>AI is analyzing your screenshots…</strong><small>Identifying classes and combining results for review.</small></div><div className="import-progress-track" role="progressbar" aria-label="AI screenshot analysis progress" style={{ '--import-progress-duration': `${progressDurationMs}ms` } as CSSProperties}><span /></div></div> : null}
            <div className="import-upload-action-bar"><button className="button button-primary button-block" disabled={phase === 'processing' || images.length === 0 || (developerMode && Boolean(developerModelError))} type="button" onClick={() => void processImages()}>
              {phase === 'processing' ? `Analyzing ${images.length <= 1 ? 'screenshot' : 'screenshots'}…` : `Analyze ${images.length <= 1 ? 'screenshot' : 'screenshots'}`}
            </button></div>
            {onboarding && phase !== 'processing' ? <div className="import-onboarding-actions">
              <button className="button button-secondary" type="button" onClick={() => { closeDialog(); onManualEntry?.() }}><FileImage size={17} aria-hidden="true" /> Enter Schedule Manually</button>
              <button className="text-button" type="button" onClick={closeDialog}>I’ll do this later</button>
            </div> : null}
          </div>
        ) : (
          <div className="import-review-step">
            <div className="import-review-heading">
              <div><h3>{isGuest ? 'Your imported schedule' : 'Review every class'}</h3><p>{isGuest ? 'Check the classes we found. Create an account only when you are ready to save and compare.' : 'Course names are restricted to the existing catalogue. Only conflicts within this imported schedule block replacement.'}</p></div>
              <button className="button button-secondary" type="button" onClick={() => setPhase('upload')} disabled={phase === 'saving'}>Back to images</button>
            </div>
            {message ? <div className="notice-box"><CheckCircle2 aria-hidden="true" /><span>{message}</span></div> : null}
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}
            {isGuest ? <section className="guest-import-match-card" aria-live="polite">
              <Sparkles aria-hidden="true" />
              <div><strong>{resultSummary.shared_student_count ?? 0} {(resultSummary.shared_student_count ?? 0) === 1 ? 'student shares' : 'students share'} a class with you</strong><span>Create an account to save this schedule and see who.</span></div>
            </section> : <div className="notice-box"><AlertTriangle aria-hidden="true" /><span>Confirming will replace the {existingClassCount} {existingClassNoun} currently on your schedule. The replacement is saved atomically.</span></div>}
            <div className="import-review-controls" aria-label="Review row display controls">
              <button className="button button-secondary" type="button" onClick={() => setExpandedRowIds(new Set(rows.map((row) => row.id)))}>Expand all</button>
              <button className="button button-secondary" type="button" onClick={() => setExpandedRowIds(new Set())}>Collapse reviewed</button>
            </div>
            <div className="import-review-grid">
              {rows.map((row, index) => {
                const conflict = importedConflictIndexes.has(index)
                const duplicate = duplicateIndexes.has(index)
                const attention = rowNeedsAttention(row, rowErrors[index], conflict, duplicate)
                const expanded = attention || expandedRowIds.has(row.id)
                return (
                  <article className={rowErrors[index] || conflict || duplicate ? 'import-review-row has-error' : 'import-review-row'} key={row.id}>
                    <button
                      aria-expanded={expanded}
                      className="import-row-toggle"
                      type="button"
                      onClick={() => {
                        if (attention) return
                        setExpandedRowIds((current) => {
                          const next = new Set(current)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }}
                    >
                      <span className="import-row-summary">
                        <span><small>Course</small><strong>{row.course?.name ?? row.source_course_name}</strong></span>
                        <span><small>Teacher</small><strong>{teacherForImportedCourse(row.teacher_last_name, row.course?.name) || 'Not resolved'}</strong></span>
                        <span><small>Term</small><strong>{academicTermLabel(row.term)}</strong></span>
                        <span><small>Periods</small><strong>{formatMeetingSlotSummary(row.meeting_slots) || 'No periods'}</strong></span>
                        <span><small>Class action</small><strong>{row.selected_existing_class_id ? 'Use existing class' : row.course ? 'Create class' : 'Resolve course'}</strong></span>
                      </span>
                      <div className="import-flags">
                        {row.flags.includes('low_confidence') ? <span>Low confidence</span> : null}
                        {row.flags.includes('duplicate') ? <span>Overlap merged</span> : null}
                        {row.flags.includes('unresolved_course') ? <span>Course unresolved</span> : null}
                        {row.flags.includes('ambiguous_course') ? <span>Ambiguous match</span> : null}
                        {row.flags.includes('incomplete') ? <span className="danger">Incomplete</span> : null}
                        {rowErrors[index] ? <span className="danger">Error</span> : null}
                        {conflict ? <span className="danger">Schedule conflict</span> : null}
                        {duplicate ? <span className="danger">Duplicate import row</span> : null}
                      </div>
                      <ChevronDown aria-hidden="true" className={expanded ? 'is-expanded' : ''} />
                    </button>
                    {expanded ? <div className="import-row-details">
                      <label className="checkbox-row"><input type="checkbox" checked={row.include} onChange={(event) => updateRow(index, { include: event.target.checked })} /><span><strong>{row.source_course_name}</strong><small>Include this row in the replacement</small></span></label>
                      <div className="import-review-fields">
                      <CoursePicker row={row} searchCourses={searchCourses} onSelect={async (course) => {
                        const options = await loadClassOptions(course)
                        updateRow(index, {
                          course: { id: course.id, name: course.course_name, confidence: 1 },
                          teacher_last_name: teacherForImportedCourse(row.teacher_last_name, course.course_name),
                          class_options: options,
                          flags: row.flags.filter((flag) => flag !== 'unresolved_course'),
                        })
                      }} />
                      <label>Teacher last name
                        <input value={teacherForImportedCourse(row.teacher_last_name, row.course?.name)} disabled={Boolean(specialCourseKind(row.course?.name))} maxLength={120} onChange={(event) => updateRow(index, { teacher_last_name: event.target.value })} />
                      </label>
                      <label>Academic term
                        <select value={row.term} onChange={(event) => updateRow(index, { term: event.target.value as EditableScheduleImportRow['term'] })}>
                          <option value="unknown">Choose term</option>
                          <option value="full_year">{specialCourseKind(row.course?.name) === 'Lunch' ? 'Full Year (saved as both semesters)' : 'Full Year'}</option>
                          <option value="semester_1">Semester 1</option>
                          <option value="semester_2">Semester 2</option>
                        </select>
                      </label>
                      <label>Class action
                        <select value={row.selected_existing_class_id ?? ''} disabled={!row.course} onChange={(event) => {
                          const classId = event.target.value || null
                          const option = row.class_options.find((candidate) => candidate.id === classId)
                          updateRow(index, option ? {
                            selected_existing_class_id: option.id,
                            teacher_last_name: option.teacher_last_name,
                            term: option.term,
                            meeting_slots: option.meeting_slots,
                            resolution: 'existing_class',
                          } : { selected_existing_class_id: null })
                        }}>
                          <option value="">Create a new class for this course</option>
                          {row.class_options.map((option) => <option value={option.id} key={option.id}>{importClassOptionLabel(option)}</option>)}
                        </select>
                      </label>
                      </div>
                      <p className="import-resolution">{row.selected_existing_class_id ? 'Will use an existing class.' : row.course ? `Will propose a new class for existing course “${row.course.name}”.` : 'Choose an existing course before this row can be saved.'}</p>
                      <div className="import-slot-editor">
                        <MeetingSlotGrid meetingSlots={row.meeting_slots} onChange={(meetingSlots) => updateRow(index, { meeting_slots: meetingSlots })} />
                      </div>
                      {rowErrors[index] ? <p className="form-error" role="alert">{rowErrors[index]}</p> : null}
                      {conflict ? <p className="form-error">This row conflicts with another included import row in the same semester. Edit its term/slots or exclude it.</p> : null}
                      {duplicate ? <p className="form-error">These edited details duplicate another included import row.</p> : null}
                      {row.warnings.length ? <p className="import-row-warning">{row.warnings.join(' ')}</p> : null}
                      <small className="import-confidence">Extraction confidence: {Math.round(row.confidence * 100)}% · {hasMultiplePeriodsOnAnyDay(row.meeting_slots) ? 'Multiple-period class' : 'Single-period class'}</small>
                    </div> : null}
                  </article>
                )
              })}
            </div>
            <div className="import-confirm-bar">
              <p><strong>{rows.filter((row) => row.include).length}</strong> classes selected. {isGuest ? 'Your preview stays in this browser while you create an account.' : 'This will replace your current schedule.'}</p>
              <button className="button button-primary" disabled={!canConfirm || phase === 'saving'} type="button" onClick={() => void saveRows()}>{isGuest ? 'Create account to save & compare' : phase === 'saving' ? 'Replacing…' : 'Replace schedule'}</button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
