from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_replace_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, found {count}: {pattern[:120]!r}")
    path.write_text(updated, encoding="utf-8")


core = ROOT / "supabase/functions/schedule-import/core.ts"
schedule_import = ROOT / "src/lib/scheduleImport.ts"
core_test = ROOT / "supabase/functions/schedule-import/core.test.ts"
schedule_import_test = ROOT / "src/lib/scheduleImport.test.ts"

replace_once(
    core,
    """export interface DeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: ThinkingLevel
  output_token_limit: number
  timing_ms: number
  image_metadata: ImageMetadata[]
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportResponse {""",
    """export interface DeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: ThinkingLevel
  output_token_limit: number
  timing_ms: number
  image_metadata: ImageMetadata[]
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportFailureDetails {
  stage: 'request_validation' | 'configuration' | 'catalog' | 'ai_request' | 'ai_response_validation' | 'catalog_matching' | 'unknown'
  what_was_read: {
    parsed_output: unknown
    raw_output_excerpt: string | null
  }
  what_was_tried: {
    image_count: number
    image_metadata: ImageMetadata[]
    model: string | null
    thinking_level: ThinkingLevel | null
    output_token_limit: number | null
    retry_attempted: boolean
    retry_reasons: string[]
  }
  failure: {
    code: string
    message: string
    validation_errors: string[]
    provider_error: unknown
  }
}

export interface ScheduleImportResponse {""",
)

replace_once(
    core,
    """  let parsedOutput: unknown = null
  let imageMetadata: ImageMetadata[] = []
  let importId: string | null = null
""",
    """  let parsedOutput: unknown = null
  let imageMetadata: ImageMetadata[] = []
  let importId: string | null = null
  let retryCount = 0
  let retryReasons: string[] = []
""",
)

replace_once(
    core,
    """    rawOutput = await invokeGemini(images, config, dependencies)
    const firstPass = await buildImportPass(rawOutput, token, config, catalog, dependencies)
    let selectedPass = firstPass
    let retryCount = 0
    const retryReasons = reviewIssueReasons(firstPass.rows)
    const responseWarnings: string[] = []
    parsedOutput = firstPass.parsed
""",
    """    rawOutput = await invokeGemini(images, config, dependencies)
    const firstParsed = parseGeminiSchedule(rawOutput)
    parsedOutput = firstParsed
    const firstPass = await buildImportPass(firstParsed, token, config, catalog, dependencies)
    let selectedPass = firstPass
    retryReasons = reviewIssueReasons(firstPass.rows)
    const responseWarnings: string[] = []
""",
)

replace_once(
    core,
    """        const retryPass = await buildImportPass(retryOutput, token, config, catalog, dependencies)
        const useRetry = importPassIsBetter(retryPass, firstPass)
""",
    """        const retryParsed = parseGeminiSchedule(retryOutput)
        const retryPass = await buildImportPass(retryParsed, token, config, catalog, dependencies)
        const useRetry = importPassIsBetter(retryPass, firstPass)
""",
)

replace_once(
    core,
    """        processing_duration_ms: elapsedMs,
        ...(developer ? { developer } : {}),
""",
    """        processing_duration_ms: elapsedMs,
        failure_details: buildFailureDetails(
          error,
          config,
          rawOutput,
          parsedOutput,
          imageMetadata,
          retryCount,
          retryReasons,
        ),
        ...(developer ? { developer } : {}),
""",
)

replace_once(
    core,
    """async function buildImportPass(
  rawOutput: string,
  token: string,
  config: ImportConfiguration,
  catalog: CourseRecord[],
  dependencies: ScheduleImportDependencies,
): Promise<ImportPass> {
  const parsed = parseGeminiSchedule(rawOutput)
  const normalizedRows = normalizeGeminiRows(parsed)
""",
    """async function buildImportPass(
  parsed: GeminiSchedule,
  token: string,
  config: ImportConfiguration,
  catalog: CourseRecord[],
  dependencies: ScheduleImportDependencies,
): Promise<ImportPass> {
  const normalizedRows = normalizeGeminiRows(parsed)
""",
)

replace_once(
    core,
    """async function persistDiagnosticSafely(
""",
    """function failureStage(code: string): ScheduleImportFailureDetails['stage'] {
  if ([
    'method_not_allowed', 'origin_not_allowed', 'authentication_required', 'session_expired',
    'multipart_required', 'invalid_form_data', 'invalid_image_count', 'invalid_import_id',
    'invalid_developer_mode', 'invalid_developer_option', 'unsupported_file_type',
    'empty_file', 'image_too_large', 'invalid_image_data',
  ].includes(code)) return 'request_validation'
  if ([
    'authorization_mismatch', 'developer_mode_forbidden', 'developer_overrides_not_allowed',
    'schedule_import_not_configured', 'rate_limit_context_invalid', 'rate_limit_exceeded',
    'invalid_model_configuration',
  ].includes(code)) return 'configuration'
  if (code === 'catalog_unavailable') return 'catalog'
  if (code === 'classes_unavailable') return 'catalog_matching'
  if (['ai_invalid_response', 'schedule_not_detected', 'schedule_unreadable'].includes(code)) return 'ai_response_validation'
  if (code.startsWith('ai_')) return 'ai_request'
  return 'unknown'
}

function rawOutputExcerpt(rawOutput: string | null): string | null {
  if (!rawOutput) return null
  const sanitized = String(redactSensitiveValue(rawOutput))
  return sanitized.length > 12_000 ? `${sanitized.slice(0, 12_000)}…` : sanitized
}

function buildFailureDetails(
  error: HttpError,
  config: ImportConfiguration | null,
  rawOutput: string | null,
  parsedOutput: unknown,
  imageMetadata: ImageMetadata[],
  retryCount: number,
  retryReasons: string[],
): ScheduleImportFailureDetails {
  return {
    stage: failureStage(error.code),
    what_was_read: {
      parsed_output: parsedOutput,
      raw_output_excerpt: parsedOutput === null ? rawOutputExcerpt(rawOutput) : null,
    },
    what_was_tried: {
      image_count: imageMetadata.length,
      image_metadata: imageMetadata,
      model: config?.model_id ?? null,
      thinking_level: config?.thinking_level ?? null,
      output_token_limit: config?.output_token_limit ?? null,
      retry_attempted: retryCount > 0,
      retry_reasons: retryReasons,
    },
    failure: {
      code: error.code,
      message: error.message,
      validation_errors: error.validationErrors,
      provider_error: error.providerDetails,
    },
  }
}

async function persistDiagnosticSafely(
""",
)

replace_once(
    schedule_import,
    """export interface ScheduleImportDeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: 'minimal' | 'low' | 'medium' | 'high'
  output_token_limit: number
  timing_ms: number
  image_metadata: Array<{ index: number; mime_type: string; byte_size: number }>
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportDeveloperOptions {""",
    """export interface ScheduleImportDeveloperDiagnostics {
  prompt: string
  raw_gemini_output: string | null
  parsed_output: unknown
  validation_errors: string[]
  model: string
  thinking_level: 'minimal' | 'low' | 'medium' | 'high'
  output_token_limit: number
  timing_ms: number
  image_metadata: Array<{ index: number; mime_type: string; byte_size: number }>
  provider_error: unknown
  diagnostic_log_id: string | null
  diagnostic_log_error?: string
}

export interface ScheduleImportFailureDetails {
  stage: 'request_validation' | 'configuration' | 'catalog' | 'ai_request' | 'ai_response_validation' | 'catalog_matching' | 'unknown'
  what_was_read: {
    parsed_output: unknown
    raw_output_excerpt: string | null
  }
  what_was_tried: {
    image_count: number
    image_metadata: Array<{ index: number; mime_type: string; byte_size: number }>
    model: string | null
    thinking_level: ScheduleImportDeveloperDiagnostics['thinking_level'] | null
    output_token_limit: number | null
    retry_attempted: boolean
    retry_reasons: string[]
  }
  failure: {
    code: string
    message: string
    validation_errors: string[]
    provider_error: unknown
  }
}

export interface ScheduleImportDeveloperOptions {""",
)

replace_once(
    schedule_import,
    """export interface EditableScheduleImportRow extends ScheduleImportRow {
  selected_existing_class_id: string | null
  include: boolean
}

export interface ScheduleImportErrorBody {""",
    """export interface ScheduleImportRowLogSnapshot {
  course: { id: string; name: string } | null
  teacher_last_name: string
  term: ImportTerm
  meeting_slots: MeetingSlot[]
  selected_existing_class_id: string | null
  include: boolean
  resolution: ScheduleImportRow['resolution']
  flags: ImportFlag[]
  warnings: string[]
}

export interface EditableScheduleImportRow extends ScheduleImportRow {
  selected_existing_class_id: string | null
  include: boolean
  original_import_row?: ScheduleImportRowLogSnapshot
}

export interface ScheduleImportCorrectionDetail {
  row_id: string
  source_course_name: string
  changes: string[]
  imported: ScheduleImportRowLogSnapshot
  corrected: ScheduleImportRowLogSnapshot
}

export interface ScheduleImportErrorBody {""",
)

replace_once(
    schedule_import,
    """  processing_duration_ms?: number
  developer?: ScheduleImportDeveloperDiagnostics
}
""",
    """  processing_duration_ms?: number
  developer?: ScheduleImportDeveloperDiagnostics
  failure_details?: ScheduleImportFailureDetails
}
""",
)

replace_once(
    schedule_import,
    """      void recordScheduleImportEvent(eventType, errorBody.import_id ?? importId, 'failed', {
        error_category: code,
        processing_duration_ms: errorBody.processing_duration_ms ?? Math.round(performance.now() - startedAt),
        ai_model: errorBody.model ?? errorBody.developer?.model ?? 'configured-production-model',
        image_count: files.length,
      }).catch(() => undefined)
""",
    """      const failureDetails = errorBody.failure_details
      const failureMessage = errorBody.message || importErrorMessage(errorBody.error, response?.status ?? 0)
      void recordScheduleImportEvent(eventType, errorBody.import_id ?? importId, 'failed', {
        error_category: code,
        processing_duration_ms: errorBody.processing_duration_ms ?? Math.round(performance.now() - startedAt),
        ai_model: errorBody.model ?? errorBody.developer?.model ?? 'configured-production-model',
        image_count: files.length,
        failure_stage: failureDetails?.stage ?? 'edge_function',
        what_was_read: failureDetails?.what_was_read ?? null,
        what_was_tried: failureDetails?.what_was_tried ?? {
          action: 'invoke_schedule_import',
          image_count: files.length,
          developer_mode: developerOptions.enabled,
        },
        failure_cause: failureDetails?.failure ?? {
          code,
          message: failureMessage,
          validation_errors: [],
          provider_error: null,
        },
      }).catch(() => undefined)
""",
)

replace_once(
    schedule_import,
    """    void recordScheduleImportEvent('schedule_import_failed', importId, 'failed', {
      error_category: 'service_unreachable',
      processing_duration_ms: Math.round(performance.now() - startedAt),
      image_count: files.length,
    }).catch(() => undefined)
""",
    """    void recordScheduleImportEvent('schedule_import_failed', importId, 'failed', {
      error_category: 'service_unreachable',
      processing_duration_ms: Math.round(performance.now() - startedAt),
      image_count: files.length,
      failure_stage: 'client_invoke',
      what_was_read: null,
      what_was_tried: {
        action: 'invoke_schedule_import',
        image_count: files.length,
        developer_mode: developerOptions.enabled,
      },
      failure_cause: {
        code: 'service_unreachable',
        message: caught instanceof Error ? caught.message : 'The schedule import service could not be reached.',
      },
    }).catch(() => undefined)
""",
)

replace_once(
    schedule_import,
    """function scheduleReplacementErrorMessage(error: { message?: string; details?: string; hint?: string }): string {
""",
    """function scheduleImportRowLogSnapshot(row: EditableScheduleImportRow): ScheduleImportRowLogSnapshot {
  return {
    course: row.course ? { id: row.course.id, name: row.course.name } : null,
    teacher_last_name: row.teacher_last_name,
    term: row.term,
    meeting_slots: sortMeetingSlots(row.meeting_slots),
    selected_existing_class_id: row.selected_existing_class_id,
    include: row.include,
    resolution: row.resolution,
    flags: [...row.flags],
    warnings: [...row.warnings],
  }
}

function slotsLogKey(slots: MeetingSlot[]): string {
  return sortMeetingSlots(slots).map((slot) => `${slot.day_type}${slot.period_number}`).join(',')
}

export function scheduleImportCorrectionDetails(rows: EditableScheduleImportRow[]): ScheduleImportCorrectionDetail[] {
  return rows.flatMap((row) => {
    const imported = row.original_import_row ?? scheduleImportRowLogSnapshot(row)
    const corrected = scheduleImportRowLogSnapshot(row)
    const changes: string[] = []
    if (imported.include !== corrected.include) changes.push('included')
    if (imported.course?.id !== corrected.course?.id || imported.course?.name !== corrected.course?.name) changes.push('course')
    if (imported.teacher_last_name !== corrected.teacher_last_name) changes.push('teacher_last_name')
    if (imported.term !== corrected.term) changes.push('term')
    if (slotsLogKey(imported.meeting_slots) !== slotsLogKey(corrected.meeting_slots)) changes.push('meeting_slots')
    if (imported.selected_existing_class_id !== corrected.selected_existing_class_id) changes.push('selected_existing_class')
    if (changes.length === 0) return []
    return [{
      row_id: row.id,
      source_course_name: row.source_course_name,
      changes,
      imported,
      corrected,
    }]
  })
}

function scheduleImportReadLog(rows: EditableScheduleImportRow[]) {
  return rows.map((row) => ({
    row_id: row.id,
    source_course_name: row.source_course_name,
    ...(row.original_import_row ?? scheduleImportRowLogSnapshot(row)),
  }))
}

function scheduleReplacementFailureCategory(
  error: Error,
  databaseError: { message?: string; details?: string; hint?: string } | null,
): string {
  const message = [error.message, databaseError?.message, databaseError?.details, databaseError?.hint].filter(Boolean).join(' ')
  if (message.includes('import_schedule_conflict')) return 'schedule_conflict'
  if (message.includes('import_existing_class_mismatch')) return 'existing_class_changed'
  if (message.includes('duplicate_import_class')) return 'duplicate_class'
  if (message.includes('invalid_import_schedule')) return 'invalid_reviewed_schedule'
  if (message.includes('reported') && message.includes('reviewed classes')) return 'replacement_count_mismatch'
  if (message.includes('returned an invalid response') || message.includes('invalid counts')) return 'invalid_replacement_response'
  return databaseError ? 'database_replacement_failure' : 'review_validation_failure'
}

function scheduleReplacementErrorMessage(error: { message?: string; details?: string; hint?: string }): string {
""",
)

regex_replace_once(
    schedule_import,
    r"export async function confirmScheduleImport\(rows: EditableScheduleImportRow\[\]\): Promise<\{ added: number; removed: number \}> \{.*?\n\}\n\nexport function teacherForImportedCourse",
    """export async function confirmScheduleImport(rows: EditableScheduleImportRow[]): Promise<{ added: number; removed: number }> {
  if (!supabase) throw new Error('Sign in before replacing your schedule.')
  const importId = rows.find((row) => row.import_id)?.import_id
  const corrections = scheduleImportCorrectionDetails(rows)
  let replacementRows: Array<{
    existing_class_id: string | null
    course_name_id: string
    teacher_last_name: string
    academic_term: AcademicTerm
    meeting_slots: MeetingSlot[]
  }> = []
  let savedRows: Array<Record<string, unknown>> = []
  let databaseError: { message?: string; details?: string; hint?: string } | null = null

  try {
    const includedRows = rows.filter((row) => row.include)
    if (includedRows.length === 0) throw new Error('Select at least one class before replacing your schedule.')

    const semesterRows = collapseMatchingLunchRows(includedRows)
    replacementRows = semesterRows.map((row) => {
      const validationError = importRowError(row)
      if (validationError || !row.course || row.term === 'unknown') {
        throw new Error(validationError ?? 'Review every import row before saving.')
      }
      return {
        existing_class_id: row.selected_existing_class_id,
        course_name_id: row.course.id,
        teacher_last_name: teacherForImportedCourse(row.teacher_last_name, row.course.name),
        academic_term: row.term,
        meeting_slots: sortMeetingSlots(row.meeting_slots),
      }
    })
    savedRows = semesterRows.map((row, index) => ({
      ...replacementRows[index],
      course_name: row.course?.name ?? row.source_course_name,
      source_row_id: row.id,
    }))

    const { data, error } = await supabase.rpc('replace_schedule_from_import', {
      p_rows: replacementRows as unknown as Json,
    })
    if (error) {
      databaseError = error
      throw new Error(scheduleReplacementErrorMessage(error))
    }

    const result = Array.isArray(data) ? data[0] : data
    if (!result || typeof result !== 'object') throw new Error('Schedule replacement returned an invalid response.')
    const added = Number((result as ScheduleReplacementResult).added_count)
    const removed = Number((result as ScheduleReplacementResult).removed_count)
    if (!Number.isInteger(added) || !Number.isInteger(removed)) throw new Error('Schedule replacement returned invalid counts.')
    if (added !== replacementRows.length) throw new Error(`Schedule replacement reported ${added} of ${replacementRows.length} reviewed classes. Reload the page before trying again.`)
    if (importId) {
      const reviewMetadata = {
        classes_found: rows.length,
        classes_matched: replacementRows.length,
        review_required: true,
        what_was_read: scheduleImportReadLog(rows),
        what_was_saved: savedRows,
        corrections,
      }
      void recordScheduleImportEvent('schedule_import_review_completed', importId, 'succeeded', reviewMetadata).catch(() => undefined)
      if (corrections.length > 0) {
        void recordScheduleImportEvent('schedule_import_corrected', importId, 'succeeded', reviewMetadata).catch(() => undefined)
      }
    }
    void recordAuthenticatedEvent('schedule_replaced', 'succeeded', { added_count: added, removed_count: removed }).catch(() => undefined)
    return { added, removed }
  } catch (caught) {
    const failure = caught instanceof Error ? caught : new Error('The reviewed schedule could not be saved.')
    if (importId) {
      const errorCategory = scheduleReplacementFailureCategory(failure, databaseError)
      const failureMetadata = {
        error_category: errorCategory,
        failure_stage: replacementRows.length > 0 ? 'schedule_replacement' : 'review_validation',
        what_was_read: scheduleImportReadLog(rows),
        what_was_tried: {
          action: replacementRows.length > 0 ? 'replace_schedule_from_import' : 'validate_reviewed_import',
          included_row_count: rows.filter((row) => row.include).length,
          rows: savedRows,
        },
        failure_cause: {
          code: errorCategory,
          message: failure.message,
          database_error: databaseError,
        },
        corrections,
      }
      void recordScheduleImportEvent('schedule_import_review_failed', importId, 'failed', failureMetadata).catch(() => undefined)
      if (errorCategory === 'schedule_conflict') {
        void recordScheduleImportEvent('schedule_import_conflict_detected', importId, 'failed', failureMetadata).catch(() => undefined)
      }
    }
    throw failure
  }
}

export function teacherForImportedCourse""",
)

regex_replace_once(
    schedule_import,
    r"export function editableRowsFromImportResult\(result: ScheduleImportResult\): EditableScheduleImportRow\[\] \{.*?\n\}\n\nexport function scheduleImportPreviewEnrollments",
    """export function editableRowsFromImportResult(result: ScheduleImportResult): EditableScheduleImportRow[] {
  return result.rows.map((row) => {
    const savedReview = row as ScheduleImportRow & Partial<Pick<EditableScheduleImportRow, 'include' | 'selected_existing_class_id' | 'original_import_row'>>
    const normalizedTerm = normalizeReviewTerm(row.term)
    const normalizedRow = reconcileExactClassSelection({
      ...row,
      term: normalizedTerm === 'unknown' && (row.course?.term_policy ?? 'full_year') === 'full_year'
        ? 'full_year'
        : normalizedTerm,
      selected_existing_class_id: savedReview.selected_existing_class_id ?? row.existing_class_id,
      include: savedReview.include ?? true,
      original_import_row: savedReview.original_import_row,
    })
    return {
      ...normalizedRow,
      original_import_row: savedReview.original_import_row ?? scheduleImportRowLogSnapshot(normalizedRow),
    }
  })
}

export function scheduleImportPreviewEnrollments""",
)

replace_once(
    schedule_import_test,
    """  reconcileExactClassSelection,
  scheduleImportPreviewEnrollments,
""",
    """  reconcileExactClassSelection,
  scheduleImportCorrectionDetails,
  scheduleImportPreviewEnrollments,
""",
)

replace_once(
    schedule_import_test,
    """  it('maps database replacement conflicts to a reviewable message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'import_schedule_conflict' } })
    await expect(confirmScheduleImport([row])).rejects.toThrow('imported classes conflict with each other')
  })
""",
    """  it('maps database replacement conflicts to a reviewable message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'import_schedule_conflict' } })
    await expect(confirmScheduleImport([row])).rejects.toThrow('imported classes conflict with each other')
  })

  it('records exactly what a user corrected and what was saved', async () => {
    const importId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const [reviewed] = editableRowsFromImportResult({
      import_id: importId,
      image_count: 1,
      warnings: [],
      rows: [{ ...row, import_id: importId }],
    })
    const corrected = reconcileExactClassSelection({
      ...reviewed,
      teacher_last_name: 'Carter',
      meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
    })

    expect(scheduleImportCorrectionDetails([corrected])).toEqual([
      expect.objectContaining({
        row_id: row.id,
        changes: expect.arrayContaining(['teacher_last_name', 'meeting_slots', 'selected_existing_class']),
        imported: expect.objectContaining({ teacher_last_name: 'Lester' }),
        corrected: expect.objectContaining({ teacher_last_name: 'Carter' }),
      }),
    ])

    await confirmScheduleImport([corrected])
    expect(mocks.recordScheduleImportEvent).toHaveBeenCalledWith(
      'schedule_import_corrected',
      importId,
      'succeeded',
      expect.objectContaining({
        what_was_read: [expect.objectContaining({ teacher_last_name: 'Lester' })],
        what_was_saved: [expect.objectContaining({ teacher_last_name: 'Carter', course_name: 'AP Statistics' })],
        corrections: [expect.objectContaining({ changes: expect.arrayContaining(['teacher_last_name', 'meeting_slots']) })],
      }),
    )
  })

  it('records the attempted rows and exact cause when reviewed import saving fails', async () => {
    const importId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const [reviewed] = editableRowsFromImportResult({
      import_id: importId,
      image_count: 1,
      warnings: [],
      rows: [{ ...row, import_id: importId }],
    })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'import_schedule_conflict', details: 'A1 overlaps another full-year row.' } })

    await expect(confirmScheduleImport([reviewed])).rejects.toThrow('imported classes conflict with each other')
    expect(mocks.recordScheduleImportEvent).toHaveBeenCalledWith(
      'schedule_import_review_failed',
      importId,
      'failed',
      expect.objectContaining({
        error_category: 'schedule_conflict',
        what_was_tried: expect.objectContaining({
          action: 'replace_schedule_from_import',
          rows: [expect.objectContaining({ course_name: 'AP Statistics', teacher_last_name: 'Lester' })],
        }),
        failure_cause: expect.objectContaining({
          code: 'schedule_conflict',
          message: expect.stringContaining('conflict'),
          database_error: expect.objectContaining({ details: 'A1 overlaps another full-year row.' }),
        }),
      }),
    )
  })
""",
)

replace_once(
    core_test,
    """  it('parses only the required structured shape', () => {
""",
    """  it('returns detailed failure logging data for malformed and rejected AI readings', async () => {
    const malformedResponse = await handleScheduleImportRequest(request([png()]), dependencies({ output: 'not-json' }))
    const malformedBody = await responseBody(malformedResponse)
    expect(malformedBody.failure_details).toMatchObject({
      stage: 'ai_response_validation',
      what_was_read: { parsed_output: null, raw_output_excerpt: 'not-json' },
      what_was_tried: {
        image_count: 1,
        model: 'gemini-3.5-flash-lite',
        retry_attempted: false,
      },
      failure: {
        code: 'ai_invalid_response',
        validation_errors: [expect.stringContaining('not valid JSON')],
      },
    })

    const rejectedRead = { schedule: false, issue: 'The period column is cropped out.', rows: [] }
    const rejectedResponse = await handleScheduleImportRequest(request([png()]), dependencies({ output: rejectedRead }))
    const rejectedBody = await responseBody(rejectedResponse)
    expect(rejectedBody.failure_details).toMatchObject({
      stage: 'ai_response_validation',
      what_was_read: { parsed_output: rejectedRead, raw_output_excerpt: null },
      failure: {
        code: 'schedule_not_detected',
        message: expect.stringContaining('period column is cropped out'),
      },
    })
  })

  it('parses only the required structured shape', () => {
""",
)

print("Importer logging patch applied successfully.")
