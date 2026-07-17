import { AlertTriangle, Bug, CheckCircle2, ClipboardPaste, FileImage, Sparkles, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useCourseNameSearch, type CourseNameSearchExecutor } from '../../hooks/useCourseNameSearch'
import type { CourseNameSearchResult, MeetingSlot, ScheduleEnrollment, ScheduleImportModelRecord } from '../../lib/domain'
import { hasMultiplePeriodsOnAnyDay, sameSlot, sortMeetingSlots, termsOverlap } from '../../lib/schedule'
import {
  confirmScheduleImport,
  findClassesForCourse,
  importClassOptionLabel,
  importRowError,
  prepareScheduleImage,
  reconcileExactClassSelection,
  ScheduleImportRequestError,
  submitScheduleScreenshots,
  teacherForImportedCourse,
  type EditableScheduleImportRow,
  type ImportClassOption,
  type ScheduleImportResult,
  type ScheduleImportDeveloperDiagnostics,
  type ScheduleImportDeveloperOptions,
} from '../../lib/scheduleImport'
import { adminListScheduleImportModels } from '../../lib/supabase/data'
import { normalizeTeacherLastName } from '../../lib/teacher'
import { MeetingSlotGrid } from './MeetingSlotGrid'

interface ImportImage {
  file: File
  previewUrl: string
}

export interface ScheduleImportDialogProps {
  open: boolean
  isAdmin?: boolean
  currentEnrollments: ScheduleEnrollment[]
  onClose: () => void
  onImported: () => Promise<void>
  importScreenshots?: (files: File[], developerOptions?: ScheduleImportDeveloperOptions) => Promise<ScheduleImportResult>
  searchCourses?: CourseNameSearchExecutor
  loadClassOptions?: (course: CourseNameSearchResult) => Promise<ImportClassOption[]>
  confirmImport?: (rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>
  loadDeveloperModels?: () => Promise<ScheduleImportModelRecord[]>
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

export function ScheduleImportDialog({
  open,
  isAdmin = false,
  currentEnrollments,
  onClose,
  onImported,
  importScreenshots = submitScheduleScreenshots,
  searchCourses,
  loadClassOptions = findClassesForCourse,
  confirmImport = confirmScheduleImport,
  loadDeveloperModels = adminListScheduleImportModels,
}: ScheduleImportDialogProps) {
  const [images, setImages] = useState<Array<ImportImage | null>>([null, null])
  const [rows, setRows] = useState<EditableScheduleImportRow[]>([])
  const [phase, setPhase] = useState<'upload' | 'processing' | 'review' | 'saving'>('upload')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [developerMode, setDeveloperMode] = useState(false)
  const [developerModels, setDeveloperModels] = useState<ScheduleImportModelRecord[]>([])
  const [developerModelId, setDeveloperModelId] = useState('')
  const [developerThinkingLevel, setDeveloperThinkingLevel] = useState<NonNullable<ScheduleImportDeveloperOptions['thinkingLevel']>>('low')
  const [developerData, setDeveloperData] = useState<ScheduleImportDeveloperDiagnostics | null>(null)
  const [developerModelError, setDeveloperModelError] = useState<string | null>(null)
  const imagesRef = useRef(images)
  imagesRef.current = images

  useEffect(() => () => {
    imagesRef.current.forEach((item) => { if (item) URL.revokeObjectURL(item.previewUrl) })
  }, [])

  const addFiles = useCallback(async (incoming: File[], preferredIndex?: number) => {
    setError(null)
    for (const input of incoming.slice(0, 2)) {
      try {
        const file = await prepareScheduleImage(input)
        setImages((current) => {
          const next = [...current]
          const index = preferredIndex ?? next.findIndex((item) => item === null)
          if (index < 0) {
            setError('Both screenshot slots are full. Replace or remove one before adding another image.')
            return current
          }
          const previous = next[index]
          if (previous) URL.revokeObjectURL(previous.previewUrl)
          next[index] = { file, previewUrl: URL.createObjectURL(file) }
          preferredIndex = undefined
          return next
        })
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The screenshot could not be added.')
      }
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

  const updateRow = useCallback((index: number, update: Partial<EditableScheduleImportRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? reconcileExactClassSelection({ ...row, ...update }) : row))
  }, [])

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
      current.forEach((item) => { if (item) URL.revokeObjectURL(item.previewUrl) })
      return [null, null]
    })
    setRows([])
    setPhase('upload')
    setError(null)
    setMessage(null)
    setDeveloperMode(false)
    setDeveloperModels([])
    setDeveloperModelId('')
    setDeveloperThinkingLevel('low')
    setDeveloperData(null)
    setDeveloperModelError(null)
    onClose()
  }

  async function processImages() {
    const files = images.flatMap((item) => item ? [item.file] : [])
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
        selected_existing_class_id: row.existing_class_id,
        include: true,
      }))
      setRows(editable.map(reconcileExactClassSelection))
      setMessage(result.warnings.join(' '))
      setDeveloperData(result.developer ?? null)
      setPhase('review')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The schedule could not be imported.')
      setDeveloperData(caught instanceof ScheduleImportRequestError ? caught.developer ?? null : null)
      setPhase('upload')
    }
  }

  async function saveRows() {
    if (!canConfirm) return
    setPhase('saving')
    setError(null)
    try {
      await confirmImport(rows)
      await onImported()
      closeDialog()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reviewed schedule could not be saved.')
      setPhase('review')
      await onImported()
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    void addFiles([...event.dataTransfer.files])
  }

  if (!open) return null
  return (
    <div className="dialog-backdrop import-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== 'saving') closeDialog() }}>
      <section className="class-dialog schedule-import-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-import-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <div><h2 id="schedule-import-title">Import screenshots</h2><p>AI-assisted review · Nothing is saved until you confirm</p></div>
          <button className="icon-button" type="button" aria-label="Close import dialog" onClick={closeDialog} disabled={phase === 'saving'}><X aria-hidden="true" /></button>
        </header>

        {phase === 'upload' || phase === 'processing' ? (
          <div className="import-upload-step">
            <div className="import-privacy-note"><Sparkles aria-hidden="true" /><p><strong>Upload or paste up to two PowerSchool screenshots.</strong><span>Crop out your name and student ID. Keep each course, teacher, term, and visible meeting detail together.</span></p></div>
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
            <div className="import-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
              <Upload aria-hidden="true" />
              <strong>Drop screenshots here</strong>
              <span>or choose files below · PNG, JPEG, or WebP · 5 MB each</span>
              <small><ClipboardPaste size={15} aria-hidden="true" /> Ctrl+V or Cmd+V pastes into the first empty slot.</small>
            </div>
            <div className="import-image-slots">
              {images.map((item, index) => (
                <div className={item ? 'import-image-slot has-image' : 'import-image-slot'} key={index}>
                  {item ? <img src={item.previewUrl} alt={`Schedule screenshot ${index + 1} preview`} /> : <FileImage aria-hidden="true" />}
                  <span>{item ? item.file.name : `Screenshot ${index + 1}`}</span>
                  <div>
                    <label className="button button-secondary">
                      {item ? 'Replace' : 'Choose image'}
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        aria-label={`${item ? 'Replace' : 'Choose'} screenshot ${index + 1}`}
                        hidden
                        type="file"
                        onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFiles([file], index); event.target.value = '' }}
                      />
                    </label>
                    {item ? <button type="button" onClick={() => setImages((current) => current.map((candidate, candidateIndex) => {
                      if (candidateIndex !== index) return candidate
                      if (candidate) URL.revokeObjectURL(candidate.previewUrl)
                      return null
                    }))}>Remove</button> : null}
                  </div>
                </div>
              ))}
            </div>
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}
            <button className="button button-primary button-block" disabled={phase === 'processing' || images.every((item) => !item) || (developerMode && Boolean(developerModelError))} type="button" onClick={() => void processImages()}>
              {phase === 'processing' ? 'Reading schedule…' : 'Review imported classes'}
            </button>
          </div>
        ) : (
          <div className="import-review-step">
            <div className="import-review-heading">
              <div><h3>Review every class</h3><p>Course names are restricted to the existing catalogue. Only conflicts within this imported schedule block replacement.</p></div>
              <button className="button button-secondary" type="button" onClick={() => setPhase('upload')} disabled={phase === 'saving'}>Back to images</button>
            </div>
            {message ? <div className="notice-box"><CheckCircle2 aria-hidden="true" /><span>{message}</span></div> : null}
            {error ? <div className="notice-box error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}
            {developerData ? <DeveloperDiagnosticsPanel diagnostics={developerData} /> : null}
            <div className="notice-box"><AlertTriangle aria-hidden="true" /><span>Confirming will replace the {existingClassCount} {existingClassNoun} currently on your schedule. The replacement is saved atomically.</span></div>
            <div className="import-review-grid">
              {rows.map((row, index) => {
                const conflict = importedConflictIndexes.has(index)
                const duplicate = duplicateIndexes.has(index)
                return (
                  <article className={rowErrors[index] || conflict || duplicate ? 'import-review-row has-error' : 'import-review-row'} key={row.id}>
                    <header>
                      <label className="checkbox-row"><input type="checkbox" checked={row.include} onChange={(event) => updateRow(index, { include: event.target.checked })} /><span><strong>{row.source_course_name}</strong><small>Include this row</small></span></label>
                      <div className="import-flags">
                        {row.flags.includes('low_confidence') ? <span>Low confidence</span> : null}
                        {row.flags.includes('duplicate') ? <span>Overlap merged</span> : null}
                        {row.flags.includes('unresolved_course') ? <span>Course unresolved</span> : null}
                        {row.flags.includes('ambiguous_course') ? <span>Ambiguous match</span> : null}
                        {conflict ? <span className="danger">Schedule conflict</span> : null}
                        {duplicate ? <span className="danger">Duplicate import row</span> : null}
                      </div>
                    </header>
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
                        <input value={teacherForImportedCourse(row.teacher_last_name, row.course?.name)} disabled={row.course?.name === 'Lunch' || row.course?.name === 'Study Hall'} maxLength={120} onChange={(event) => updateRow(index, { teacher_last_name: event.target.value })} />
                      </label>
                      <label>Academic term
                        <select value={row.term} onChange={(event) => updateRow(index, { term: event.target.value as EditableScheduleImportRow['term'] })}>
                          <option value="unknown">Choose term</option>
                          <option value="full_year">Full Year</option>
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
                  </article>
                )
              })}
            </div>
            <div className="import-confirm-bar">
              <p><strong>{rows.filter((row) => row.include).length}</strong> classes selected. This will replace your current schedule.</p>
              <button className="button button-primary" disabled={!canConfirm || phase === 'saving'} type="button" onClick={() => void saveRows()}>{phase === 'saving' ? 'Replacing…' : 'Replace schedule'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
