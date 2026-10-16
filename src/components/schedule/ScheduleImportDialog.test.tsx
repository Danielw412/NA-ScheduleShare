import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { CourseNameSearchResult, ScheduleEnrollment } from '../../lib/domain'
import type { EditableScheduleImportRow, ScheduleImportResult } from '../../lib/scheduleImport'
import { getCssDeclarations } from '../../test/css'
import styles from '../../styles/features/schedule-dialogs.css?raw'
import { ScheduleImportDialog, type ScheduleImportDialogProps } from './ScheduleImportDialog'

const COURSE_ID = '11111111-1111-4111-8111-111111111111'

function scheduleFile(name = 'schedule.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

function importResult(overrides: Partial<ScheduleImportResult['rows'][number]> = {}): ScheduleImportResult {
  return {
    image_count: 1,
    warnings: [],
    rows: [{
      id: 'import-1',
      source_course_name: 'AP Statistics (CHS)',
      course: { id: COURSE_ID, name: 'AP Statistics', confidence: 0.98 },
      teacher_last_name: 'Lester',
      term: 'full_year',
      meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
      confidence: 0.97,
      warnings: [],
      flags: [],
      resolution: 'new_class',
      existing_class_id: null,
      class_options: [],
      ...overrides,
    }],
  }
}

function currentEnrollment(): ScheduleEnrollment {
  return {
    id: 'enrollment-current',
    class_id: 'class-current',
    student_id: 'student-current',
    academic_term: 'full_year',
    active: true,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    class: {
      id: 'class-current',
      course_name_id: 'course-current',
      course_name: 'Current Course',
      teacher_last_name: 'Current',
      default_academic_term: 'full_year',
      is_double_period: false,
      meeting_slots: [{ day_type: 'A', period_number: 1 }],
    },
  }
}

function dialogProps(overrides: Partial<ScheduleImportDialogProps> = {}): ScheduleImportDialogProps {
  return {
    open: true,
    currentEnrollments: [],
    onClose: vi.fn(),
    onImported: vi.fn(async () => undefined),
    importScreenshots: vi.fn(async () => importResult()),
    searchCourses: vi.fn(async () => []),
    loadClassOptions: vi.fn(async () => []),
    confirmImport: vi.fn(async () => ({ added: 1, removed: 0 })),
    ...overrides,
  }
}

function renderDialog(overrides: Partial<ScheduleImportDialogProps> = {}) {
  const props = dialogProps(overrides)
  return { ...render(<ScheduleImportDialog {...props} />), props }
}

/** Mounts the dialog only while open, from a real trigger, as SchedulePage does. */
function DialogWithTrigger(overrides: Partial<ScheduleImportDialogProps>) {
  const [open, setOpen] = useState(false)
  const props = dialogProps(overrides)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open import</button>
    {open ? <ScheduleImportDialog {...props} onClose={() => { props.onClose(); setOpen(false) }} /> : null}
  </>
}

function conflictingClarificationResult(): ScheduleImportResult {
  const result = importResult({
    course: { id: COURSE_ID, name: 'Study Hall - NASH', confidence: 1, term_policy: 'flexible_attendance' },
    term: 'semester_1',
  })
  result.rows.push({
    ...result.rows[0],
    id: 'import-2',
    source_course_name: 'Hon Music Production 3',
    course: { id: 'course-music-production', name: 'Honors Music Production 3', confidence: 1, term_policy: 'semester' },
    teacher_last_name: 'Tozier',
  })
  return result
}

function clipboardWith(file: File) {
  return {
    items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
  }
}

beforeEach(() => {
  let objectUrl = 0
  vi.stubGlobal('createImageBitmap', undefined)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++objectUrl}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScheduleImportDialog image input', () => {
  it('accepts up to three screenshots in one file-picker action', async () => {
    const user = userEvent.setup()
    renderDialog()
    const picker = screen.getByLabelText('Choose schedule screenshots')
    expect(picker).toHaveAttribute('multiple')
    expect(screen.getByText('PNG, JPEG, or WebP, up to 10 MB each')).toBeInTheDocument()
    expect(screen.queryByText('0 of 3')).not.toBeInTheDocument()

    await user.upload(picker, [scheduleFile('one.png'), scheduleFile('two.png'), scheduleFile('three.png')])
    expect(await screen.findAllByRole('img', { name: /Schedule screenshot/ })).toHaveLength(3)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('does not silently discard a selection larger than three screenshots', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), [
      scheduleFile('one.png'),
      scheduleFile('two.png'),
      scheduleFile('three.png'),
      scheduleFile('four.png'),
    ])
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 3 screenshots')
    expect(screen.queryByAltText(/Schedule screenshot/)).not.toBeInTheDocument()
    expect(screen.queryByText('0 of 3')).not.toBeInTheDocument()
  })

  it('supports file upload and additional clipboard pastes until all three slots are full', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile('first.png'))
    expect(await screen.findByAltText('Schedule screenshot 1 preview')).toBeInTheDocument()

    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile('pasted.png')) })
    expect(await screen.findByAltText('Schedule screenshot 2 preview')).toBeInTheDocument()
    expect(screen.getByText('pasted.png')).toBeInTheDocument()

    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile('third.png')) })
    expect(await screen.findByAltText('Schedule screenshot 3 preview')).toBeInTheDocument()

    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile('fourth.png')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 3 screenshots')
  })

  it('supports drag-and-drop and sends all selected images in one combined request', async () => {
    const importScreenshots = vi.fn(async () => importResult())
    renderDialog({ importScreenshots })
    const dropZone = screen.getByText('Drop, paste, or choose schedule screenshots').closest('.schedule-import-drop')!
    fireEvent.drop(dropZone, { dataTransfer: { files: [scheduleFile('one.png'), scheduleFile('two.png'), scheduleFile('three.png')] } })
    expect(await screen.findAllByRole('img', { name: /Schedule screenshot/ })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    await waitFor(() => expect(importScreenshots).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'one.png' }),
      expect.objectContaining({ name: 'two.png' }),
      expect.objectContaining({ name: 'three.png' }),
    ]))
  })

  it('shows the AI progress bar while screenshot analysis is running', async () => {
    const user = userEvent.setup()
    let finishImport: ((result: ScheduleImportResult) => void) | undefined
    const importScreenshots = vi.fn(() => new Promise<ScheduleImportResult>((resolve) => { finishImport = resolve }))
    const confirmImport = vi.fn<(rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>>(async () => ({ added: 1, removed: 0 }))
    const loadUiSettings = vi.fn(async () => ({ progress_bar_duration_ms: 1000 }))
    renderDialog({ importScreenshots, confirmImport, loadUiSettings })
    await waitFor(() => expect(loadUiSettings).toHaveBeenCalledTimes(1))
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    const progress = screen.getByRole('progressbar', { name: 'AI screenshot analysis progress' })
    expect(progress.style.getPropertyValue('--schedule-import-progress-duration')).toBe('1000ms')
    expect(screen.getByText('Analyzing your screenshots…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyzing screenshot…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeDisabled()
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1100)) })
    expect(screen.queryByText('Checking the schedule again…')).not.toBeInTheDocument()
    expect(screen.getByText('Analyzing your screenshots…')).toBeInTheDocument()

    finishImport?.(importResult())
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
  })

  it('can replace and remove individual screenshots before analysis', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), [scheduleFile('one.png'), scheduleFile('two.png')])
    await user.upload(screen.getByLabelText('Replace screenshot 1'), scheduleFile('replacement.png'))
    expect(await screen.findByText('replacement.png')).toBeInTheDocument()
    expect(screen.queryByText('one.png')).not.toBeInTheDocument()

    const secondPreview = screen.getByAltText('Schedule screenshot 2 preview').closest('.schedule-import-image') as HTMLElement
    await user.click(within(secondPreview).getByRole('button', { name: 'Remove two.png' }))
    expect(screen.queryByText('two.png')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('keeps previews visible after a structured rejection so users can replace an image', async () => {
    const user = userEvent.setup()
    renderDialog({ importScreenshots: vi.fn(async () => { throw new Error('The screenshot shows classes but not their period numbers.') }) })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not their period numbers')
    expect(screen.getByAltText('Schedule screenshot 1 preview')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze screenshot' })).toBeEnabled()
  })

  it('opens the file picker from a keyboard-reachable button', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    renderDialog()
    const choose = screen.getByRole('button', { name: 'Choose screenshot' })
    expect(choose).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(click).toHaveBeenCalledTimes(1)
    expect(click.mock.contexts[0]).toBe(screen.getByLabelText('Choose schedule screenshots'))
  })

  it('shows a saving state instead of the review list while a clean import is applied', async () => {
    const user = userEvent.setup()
    let finishSave: ((value: { added: number; removed: number }) => void) | undefined
    const confirmImport = vi.fn(() => new Promise<{ added: number; removed: number }>((resolve) => { finishSave = resolve }))
    const onImported = vi.fn(async () => undefined)
    renderDialog({ confirmImport, onImported })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('progressbar', { name: 'Saving imported classes' })).toBeInTheDocument()
    expect(screen.getAllByText('Saving your classes…').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close import dialog' })).toBeDisabled()

    await act(async () => { finishSave?.({ added: 1, removed: 0 }) })
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ added: 1, removed: 0 }))
  })

  it('removes the paste listener when the dialog closes', async () => {
    const rendered = renderDialog()
    rendered.rerender(<ScheduleImportDialog {...rendered.props} open={false} />)
    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile()) })
    expect(screen.queryByAltText(/Schedule screenshot/)).not.toBeInTheDocument()
  })

  it('renders the onboarding flow and invokes manual entry or dismissal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onManualEntry = vi.fn()
    renderDialog({ onboarding: true, onClose, onManualEntry })

    expect(screen.getByRole('heading', { name: 'Import your schedule' })).toBeInTheDocument()
    expect(screen.getByText('Add a screenshot of your schedule and ScheduleShare will find your classes.')).toBeInTheDocument()
    expect(screen.getByText('Drop, paste, or choose schedule screenshots')).toBeInTheDocument()
    expect(screen.getByText('Choose screenshot')).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: 'Schedule import steps' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual(['Screenshot', 'Review classes', 'Find classmates'])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')

    await user.click(screen.getByRole('button', { name: 'Enter schedule manually' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onManualEntry).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /do this later/i }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('ScheduleImportDialog review and confirmation', () => {
  it('hands retried problem rows to the separate clarification flow', async () => {
    const user = userEvent.setup()
    const result = importResult({
      course: null,
      resolution: 'unresolved_course',
      flags: ['unresolved_course'],
      teacher_last_name: 'Unknown',
      term: 'unknown',
    })
    result.rows.push({
      ...result.rows[0],
      id: 'import-2',
      source_course_name: 'Mystery Course 2',
      meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
    })
    result.retry_count = 1
    result.retry_reasons = ['2 imported classes are unresolved or incomplete']
    result.warnings = ['Gemini checked the screenshots again, but the first reading remained the safer result.']
    const onNeedsClarification = vi.fn()
    renderDialog({
      currentEnrollments: [currentEnrollment()],
      importScreenshots: vi.fn(async () => result),
      onNeedsClarification,
    })

    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    await waitFor(() => expect(onNeedsClarification).toHaveBeenCalledTimes(1))
    expect(onNeedsClarification).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ retry_count: 1, retry_reasons: ['2 imported classes are unresolved or incomplete'] }),
      rowIds: ['import-1', 'import-2'],
    }))
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
  })

  it('automatically shows a clean guest import without opening review', async () => {
    const user = userEvent.setup()
    const onGuestPreview = vi.fn()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 0 }))
    renderDialog({
      isGuest: true,
      onGuestPreview,
      confirmImport,
    })

    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    await waitFor(() => expect(onGuestPreview).toHaveBeenCalledWith(expect.objectContaining({
      rows: expect.arrayContaining([expect.objectContaining({ course: expect.objectContaining({ name: 'AP Statistics' }) })]),
    })))
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
    expect(confirmImport).not.toHaveBeenCalled()
  })

  it('returns the reviewed schedule for an on-page guest preview instead of saving', async () => {
    const user = userEvent.setup()
    const onGuestPreview = vi.fn()
    const onClose = vi.fn()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 0 }))
    renderDialog({
      isGuest: true,
      initialResult: { ...importResult(), shared_student_count: 4, estimated_grade: 10 },
      onGuestPreview,
      onClose,
      confirmImport,
    })

    expect(await screen.findByRole('heading', { name: 'Review your classes' })).toBeInTheDocument()
    expect(screen.getByText('Check the classes we found. Create an account when you’re ready to save them.')).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-footer-note')).toHaveTextContent('1 class selected.')
    expect(document.querySelector('.schedule-import-footer-note')).not.toHaveTextContent('Saving replaces')
    await user.click(screen.getByRole('button', { name: 'Show imported schedule' }))

    expect(onGuestPreview).toHaveBeenCalledWith(expect.objectContaining({
      shared_student_count: 4,
      rows: expect.arrayContaining([expect.objectContaining({ course: expect.objectContaining({ name: 'AP Statistics' }) })]),
    }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmImport).not.toHaveBeenCalled()
  })

  it('keeps admin developer mode off by default and shows exact diagnostics for an explicit test request', async () => {
    const user = userEvent.setup()
    const importScreenshots = vi.fn(async () => ({
      ...importResult(),
      developer: {
        prompt: 'exact Gemini prompt',
        raw_gemini_output: '{"schedule":true}',
        parsed_output: { schedule: true },
        validation_errors: [],
        model: 'gemini-3.5-flash',
        thinking_level: 'high' as const,
        output_token_limit: 4096,
        timing_ms: 321,
        image_metadata: [{ index: 1, mime_type: 'image/png', byte_size: 3 }],
        provider_error: null,
        diagnostic_log_id: 'diagnostic-log-id',
      },
    }))
    renderDialog({
      isAdmin: true,
      importScreenshots,
      loadDeveloperModels: vi.fn(async () => [{
        model_id: 'gemini-3.5-flash',
        display_name: 'Gemini 3.5 Flash',
        enabled: true,
        supports_image_input: true,
        supports_structured_output: true,
        supported_thinking_levels: ['low', 'high'] as Array<'low' | 'high'>,
        max_output_tokens: 65536,
        is_active: true,
        production_thinking_level: 'low' as const,
        production_output_token_limit: 4096,
      }]),
    })
    const developerMode = screen.getByRole('checkbox', { name: /AI developer mode/ })
    expect(developerMode).not.toBeChecked()
    await user.click(developerMode)
    await user.selectOptions(await screen.findByLabelText('Reasoning'), 'high')
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    await waitFor(() => expect(importScreenshots).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'schedule.png' })],
      { enabled: true, modelId: 'gemini-3.5-flash', thinkingLevel: 'high' },
    ))
    expect(await screen.findByText('AI developer diagnostics')).toBeInTheDocument()
    expect(screen.getByText('exact Gemini prompt')).toBeInTheDocument()
    expect(screen.getByText('diagnostic-log-id')).toBeInTheDocument()
  })

  it('requires manual catalogue selection for unresolved courses and submits edited new-class details only on confirmation', async () => {
    const user = userEvent.setup()
    const course: CourseNameSearchResult = { id: COURSE_ID, course_name: 'AP Statistics', score: 100, course_term_policy: 'full_year' }
    const confirmImport = vi.fn<(rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>>(async () => ({ added: 1, removed: 0 }))
    renderDialog({
      initialResult: importResult({
        course: null,
        resolution: 'unresolved_course',
        flags: ['unresolved_course'],
        teacher_last_name: 'Unknown',
        term: 'unknown',
      }),
      clarificationRowIds: ['import-1'],
      searchCourses: vi.fn(async () => [course]),
      confirmImport,
    })
    expect(await screen.findByRole('heading', { name: 'Fix 1 class' })).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-issue')).toHaveTextContent(/course from the catalogue/i)
    expect(screen.getByRole('button', { name: 'Save clarifications' })).toBeDisabled()

    await user.click(await screen.findByRole('button', { name: 'AP Statistics' }))
    await user.clear(screen.getByLabelText('Teacher last name'))
    await user.type(screen.getByLabelText('Teacher last name'), 'Lester')
    expect(screen.getByText('Full-credit and unlisted courses are full year.')).toBeInTheDocument()
    await user.click(screen.getByText('Edit meeting slots'))
    await user.click(screen.getByRole('button', { name: 'A Day, Period 2' }))
    expect(screen.getByRole('button', { name: /AP Statistics.*Creates new class/i })).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-issue')).toHaveClass('is-resolved')
    expect(document.querySelector('.schedule-import-issue')).toHaveTextContent('Fixed This class is ready to save.')

    await user.click(screen.getByRole('button', { name: 'Save clarifications' }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    const rows = confirmImport.mock.calls[0][0]
    expect(rows[0]).toMatchObject({
      course: { id: COURSE_ID, name: 'AP Statistics' },
      teacher_last_name: 'Lester',
      term: 'full_year',
      resolution: 'new_class',
    })
    expect(rows[0].meeting_slots).toContainEqual({ day_type: 'A', period_number: 2 })
  })

  it('defaults a missing term to Full Year and automatically joins the exact existing class', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn<(rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>>(async () => ({ added: 1, removed: 0 }))
    const existing = {
      id: 'class-existing',
      course_id: COURSE_ID,
      teacher_last_name: 'Lester',
      term: 'full_year' as const,
      meeting_slots: [{ day_type: 'A' as const, period_number: 1 }, { day_type: 'B' as const, period_number: 1 }],
    }
    renderDialog({ confirmImport, importScreenshots: vi.fn(async () => importResult({
      term: 'unknown',
      warnings: ['Academic term was not visible, so Full Year was selected by default.'],
      class_options: [existing],
    })) })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(confirmImport.mock.calls[0][0][0]).toMatchObject({
      term: 'full_year',
      selected_existing_class_id: 'class-existing',
    })
  })

  it('prioritizes problematic rows and lets users collapse any expanded row', async () => {
    const user = userEvent.setup()
    const result = importResult()
    result.rows.push({
      ...result.rows[0],
      id: 'import-problem',
      source_course_name: 'Mystery Course',
      course: null,
      confidence: 0.42,
      meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
      flags: ['low_confidence', 'unresolved_course'],
      resolution: 'unresolved_course',
    })
    renderDialog({ initialResult: result, clarificationRowIds: ['import-problem'] })

    expect(screen.getByRole('button', { name: /Mystery Course.*Low confidence.*Course unresolved/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Catalogue course for Mystery Course')).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-issue strong')).toHaveTextContent('Course not matched')
    expect(document.querySelector('.schedule-import-row-toggle')).toHaveTextContent('Mystery Course')

    await user.click(screen.getByRole('button', { name: /Mystery Course.*Low confidence.*Course unresolved/i }))
    expect(screen.queryByLabelText('Catalogue course for Mystery Course')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Mystery Course.*Low confidence.*Course unresolved/i }))
    expect(screen.getByLabelText('Catalogue course for Mystery Course')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
  })

  it('imports valid classes first and leaves the problem class open for repair', async () => {
    const user = userEvent.setup()
    const result = importResult()
    result.rows.push({
      ...result.rows[0],
      id: 'import-problem',
      source_course_name: 'Mystery Course',
      course: null,
      teacher_last_name: 'Unknown',
      term: 'unknown',
      meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
      confidence: 0.4,
      flags: ['low_confidence', 'unresolved_course'],
      resolution: 'unresolved_course',
    })
    const confirmImport = vi.fn<(rows: EditableScheduleImportRow[]) => Promise<{ added: number; removed: number }>>(async () => ({ added: 1, removed: 0 }))
    const onImported = vi.fn(async () => undefined)
    const onNeedsClarification = vi.fn()
    renderDialog({ importScreenshots: vi.fn(async () => result), confirmImport, onImported, onNeedsClarification })

    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(confirmImport.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'import-1', include: true }),
      expect.objectContaining({ id: 'import-problem', include: false }),
    ])
    expect(onImported).toHaveBeenCalledWith({ added: 1, removed: 0 })
    expect(onNeedsClarification).toHaveBeenCalledWith(expect.objectContaining({ rowIds: ['import-problem'] }))
    const clarification = onNeedsClarification.mock.calls[0][0]
    cleanup()
    renderDialog({ initialResult: clarification.result, clarificationRowIds: clarification.rowIds })
    expect(await screen.findByRole('heading', { name: 'Fix 1 class' })).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-issue')).toHaveTextContent(/course from the catalogue/i)
    expect(screen.getByLabelText('Catalogue course for Mystery Course')).toBeInTheDocument()
  })

  it('puts the academic-term fix first for a semester schedule conflict', async () => {
    const user = userEvent.setup()
    const result = importResult({
      course: { id: COURSE_ID, name: 'Study Hall - NASH', confidence: 1, term_policy: 'flexible_attendance' },
      term: 'semester_1',
    })
    result.rows.push({
      ...result.rows[0],
      id: 'import-2',
      source_course_name: 'Hon Music Production 3',
      course: { id: 'course-music-production', name: 'Honors Music Production 3', confidence: 1, term_policy: 'semester' },
      teacher_last_name: 'Tozier',
    })

    renderDialog({ initialResult: result, clarificationRowIds: ['import-1', 'import-2'] })

    expect(await screen.findByRole('heading', { name: 'Fix 2 classes' })).toBeInTheDocument()
    expect(document.querySelectorAll('.schedule-import-issue strong')).toHaveLength(2)
    expect(document.querySelectorAll('.schedule-import-issue strong')[0]).toHaveTextContent('Schedule conflict')
    expect(screen.getAllByLabelText('Suggested fix')).toHaveLength(2)
    screen.getAllByText('Other ways to fix this class').forEach((summary) => expect(summary.closest('details')).not.toHaveAttribute('open'))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Semester' }), 'semester_2')
    expect(screen.getByRole('button', { name: 'Save clarifications' })).toBeEnabled()
    expect(screen.getAllByText('Fixed')).toHaveLength(2)
  })

  it('labels flexible attendance choices as Full year / Semester', async () => {
    const user = userEvent.setup()
    renderDialog({
      initialResult: importResult({
        course: { id: COURSE_ID, name: 'Gym', confidence: 1, term_policy: 'flexible_attendance' },
        meeting_slots: [{ day_type: 'A', period_number: 1 }],
      }),
    })

    await user.click(screen.getByRole('button', { name: /^Gym/ }))
    expect(screen.getByRole('combobox', { name: 'Full year / Semester' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Attendance format' })).not.toBeInTheDocument()
  })

  it('automatically imports a valid low-confidence extraction', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 0 }))
    const onNeedsClarification = vi.fn()
    renderDialog({
      confirmImport,
      importScreenshots: vi.fn(async () => importResult({ confidence: 0.8 })),
      onNeedsClarification,
    })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(onNeedsClarification).not.toHaveBeenCalled()
  })

  it('automatically replaces a partially filled schedule instead of treating it as a conflict', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 1 }))
    renderDialog({ currentEnrollments: [currentEnrollment()], confirmImport })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Schedule conflict')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
  })

  it('groups review rows into needs attention and ready, with expand and collapse controls', async () => {
    const user = userEvent.setup()
    const result = importResult()
    result.rows.push({
      ...result.rows[0],
      id: 'import-problem',
      source_course_name: 'Mystery Course',
      course: null,
      flags: ['unresolved_course'],
      resolution: 'unresolved_course',
      meeting_slots: [{ day_type: 'A', period_number: 4 }, { day_type: 'B', period_number: 4 }],
    })
    renderDialog({ initialResult: result })

    expect(await screen.findByRole('heading', { name: 'Review your classes' })).toBeInTheDocument()
    const attention = screen.getByRole('region', { name: 'Needs attention' })
    const ready = screen.getByRole('region', { name: 'Ready' })
    expect(within(attention).getByRole('button', { name: /Mystery Course/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(ready).getByRole('button', { name: /AP Statistics/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('1 needs attention')).toBeInTheDocument()
    expect(screen.getByText('1 ready')).toBeInTheDocument()
    expect(document.querySelector('.schedule-import-footer-note')).toHaveTextContent('2 classes selected. Saving replaces your current schedule.')

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(within(ready).getByRole('button', { name: /AP Statistics/ })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(within(attention).getByRole('button', { name: /Mystery Course/ })).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(attention).getByRole('button', { name: /Mystery Course/ }))
    await user.click(screen.getByRole('checkbox', { name: /Include this class/ }))
    expect(screen.getByRole('button', { name: /Mystery Course.*Left out/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace schedule' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Back to screenshots' }))
    expect(screen.getByRole('heading', { name: 'Import your schedule' })).toBeInTheDocument()
  })
})

describe('ScheduleImportDialog focus and cancellation', () => {
  it('focuses the screenshot picker on open and returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<StrictMode><DialogWithTrigger /></StrictMode>)
    const trigger = screen.getByRole('button', { name: 'Open import' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Choose screenshot' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens a clarification with focus inside the dialog, without mounting the upload step, and returns focus on close', async () => {
    const user = userEvent.setup()
    render(<StrictMode><DialogWithTrigger initialResult={conflictingClarificationResult()} clarificationRowIds={['import-1', 'import-2']} /></StrictMode>)
    const trigger = screen.getByRole('button', { name: 'Open import' })
    await user.click(trigger)

    expect(await screen.findByRole('heading', { name: 'Fix 2 classes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose screenshot' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)

    await user.click(screen.getByRole('button', { name: 'Close clarification dialog' }))
    expect(trigger).toHaveFocus()
  })

  it('keeps Tab inside the clarification dialog and skips controls hidden in closed sections', async () => {
    // jsdom has no layout, so emulate the browser's Element.checkVisibility():
    // anything inside a closed <details>, other than that details' own
    // summary, has no box (this includes nested closed sections).
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value(this: HTMLElement) {
        for (let details = this.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])') ?? null) {
          if (this.closest('summary')?.parentElement !== details) return false
        }
        return true
      },
    })
    onTestFinished(() => { delete (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility })
    const user = userEvent.setup()
    renderDialog({ initialResult: conflictingClarificationResult(), clarificationRowIds: ['import-1', 'import-2'] })
    expect(await screen.findByRole('heading', { name: 'Fix 2 classes' })).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Close clarification dialog' })
    expect(screen.getByRole('button', { name: 'Save clarifications' })).toBeDisabled()

    close.focus()
    await user.tab({ shift: true })
    const lastSummary = screen.getAllByText('Other ways to fix this class').at(-1)?.closest('summary')
    expect(lastSummary).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    for (let step = 0; step < 24; step += 1) {
      await user.tab()
      const active = document.activeElement as HTMLElement
      expect(dialog).toContainElement(active)
      if (active.closest('details:not([open])')) expect(active.tagName).toBe('SUMMARY')
    }
  })

  it('does not replace the schedule when the dialog is closed while analysis is still running', async () => {
    const user = userEvent.setup()
    let finishImport: ((result: ScheduleImportResult) => void) | undefined
    const importScreenshots = vi.fn(() => new Promise<ScheduleImportResult>((resolve) => { finishImport = resolve }))
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 0 }))
    const onImported = vi.fn(async () => undefined)
    const onNeedsClarification = vi.fn()
    render(<StrictMode><DialogWithTrigger importScreenshots={importScreenshots} confirmImport={confirmImport} onImported={onImported} onNeedsClarification={onNeedsClarification} /></StrictMode>)
    await user.click(screen.getByRole('button', { name: 'Open import' }))
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Analyze screenshot' }))
    expect(screen.getByText('Closing now cancels the import. Nothing has been saved yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close import dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {
      finishImport?.(importResult())
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(confirmImport).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
    expect(onNeedsClarification).not.toHaveBeenCalled()
  })

  it('drops a late guest result instead of previewing it or asking for clarification, even if the dialog stays mounted', async () => {
    const user = userEvent.setup()
    let finishImport: ((result: ScheduleImportResult) => void) | undefined
    const importScreenshots = vi.fn(() => new Promise<ScheduleImportResult>((resolve) => { finishImport = resolve }))
    const onGuestPreview = vi.fn()
    const onNeedsClarification = vi.fn()
    const onClose = vi.fn()
    const result = importResult()
    result.rows.push({ ...result.rows[0], id: 'import-problem', course: null, flags: ['unresolved_course'], resolution: 'unresolved_course' })
    renderDialog({ isGuest: true, importScreenshots, onGuestPreview, onNeedsClarification, onClose })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Analyze screenshot' }))
    await user.click(screen.getByRole('button', { name: 'Close import dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishImport?.(result)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(onGuestPreview).not.toHaveBeenCalled()
    expect(onNeedsClarification).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Review your classes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ScheduleImportDialog copy', () => {
  it('says which classes are being saved during a partial import instead of claiming everything matched', async () => {
    const user = userEvent.setup()
    let finishSave: ((value: { added: number; removed: number }) => void) | undefined
    const confirmImport = vi.fn(() => new Promise<{ added: number; removed: number }>((resolve) => { finishSave = resolve }))
    const result = importResult()
    result.rows.push({ ...result.rows[0], id: 'import-problem', source_course_name: 'Mystery Course', course: null, flags: ['unresolved_course'], resolution: 'unresolved_course', meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }] })
    renderDialog({ importScreenshots: vi.fn(async () => result), confirmImport, onNeedsClarification: vi.fn() })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Analyze screenshot' }))

    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Saving the classes we could read. We’ll ask you about the other class next.')).toBeInTheDocument()
    expect(screen.queryByText(/Everything matched/)).not.toBeInTheDocument()
    await act(async () => { finishSave?.({ added: 1, removed: 0 }) })
  })

  it('still says everything matched when a clean import is saved', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn(() => new Promise<{ added: number; removed: number }>(() => undefined))
    renderDialog({ confirmImport })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Analyze screenshot' }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Everything matched, so your schedule is being saved now.')).toBeInTheDocument()
  })

  it('names the section instead of an N/A teacher when joining an existing Lunch or Study Hall section', async () => {
    const lunchSlots = [{ day_type: 'A' as const, period_number: 8 }, { day_type: 'B' as const, period_number: 8 }]
    renderDialog({
      initialResult: importResult({
        source_course_name: 'Lunch',
        course: { id: 'course-lunch', name: 'Lunch - NASH', confidence: 1, term_policy: 'lunch' },
        teacher_last_name: 'N/A',
        term: 'unknown',
        meeting_slots: lunchSlots,
        class_options: [{ id: 'class-lunch', course_id: 'course-lunch', teacher_last_name: 'N/A', term: 'semester_1', meeting_slots: lunchSlots }],
      }),
      clarificationRowIds: ['import-1'],
    })
    expect(await screen.findByRole('heading', { name: 'Fix 1 class' })).toBeInTheDocument()
    const option = screen.getByRole('option', { name: /^Join the existing Lunch section/ })
    expect(option).toHaveTextContent('Join the existing Lunch section, P8, semester 1')
    expect(screen.queryByRole('option', { name: /N\/A/ })).not.toBeInTheDocument()
  })

  it('keeps the teacher in the label for a normal class option', async () => {
    renderDialog({
      initialResult: importResult({
        class_options: [{ id: 'class-stats', course_id: COURSE_ID, teacher_last_name: 'Lester', term: 'full_year', meeting_slots: [{ day_type: 'A', period_number: 1 }] }],
      }),
    })
    expect(await screen.findByRole('heading', { name: 'Review your classes' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /AP Statistics/ }))
    expect(screen.getByRole('option', { name: /^Join Lester’s class/ })).toBeInTheDocument()
  })

  it('explains why the picker is unavailable once three screenshots are added, without dropping focus', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    renderDialog()
    const picker = screen.getByRole('button', { name: 'Choose screenshot' })
    expect(picker).toHaveFocus()
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), [scheduleFile('one.png'), scheduleFile('two.png'), scheduleFile('three.png')])
    expect(await screen.findByText('You’ve added all 3 screenshots')).toBeInTheDocument()
    expect(screen.queryByText('Drop, paste, or choose another screenshot')).not.toBeInTheDocument()
    expect(screen.queryByText('Add another screenshot')).not.toBeInTheDocument()

    const add = screen.getByRole('button', { name: 'Add screenshot' })
    // Same element, never natively disabled, so a browser keeps focus on it.
    expect(add).toBe(picker)
    expect(add).toBeEnabled()
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveAccessibleDescription(/Replace or remove one below to use a different screenshot/)
    click.mockClear()
    await user.click(add)
    expect(click).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove one.png' }))
    expect(screen.getByText('Drop, paste, or choose another screenshot')).toBeInTheDocument()
    expect(add).not.toHaveAttribute('aria-disabled')
    expect(add).not.toHaveAccessibleDescription()
    await user.click(add)
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('ScheduleImportDialog styles', () => {
  it('shows the suggested term fix as a neutral panel, not a gold wash', () => {
    const panel = getCssDeclarations(styles, '.schedule-import-term-fix')
    expect(panel.background).toBe('var(--chalk)')
    expect(panel.border).toBe('1px solid var(--line)')
    expect(styles).not.toMatch(/\.schedule-import-term-fix\s*\{[^}]*gold/)
  })

  it('runs the progress fill for the configured duration', () => {
    expect(getCssDeclarations(styles, '.schedule-import-progress-track > span').animation)
      .toContain('var(--schedule-import-progress-duration, 6500ms)')
  })

  it('swaps desktop drop instructions for phone copy on small or touch screens', () => {
    expect(getCssDeclarations(styles, '.schedule-import-mobile-only').display).toBe('none')
    const phone = styles.slice(styles.indexOf('@media (max-width: 639px), (pointer: coarse)'))
    expect(getCssDeclarations(phone, '.schedule-import-desktop-only').display).toBe('none')
    expect(getCssDeclarations(phone, '.schedule-import-mobile-only').display).toBe('block')
  })

  it('keeps screenshot actions at touch size', () => {
    expect(getCssDeclarations(styles, '.schedule-import-image-actions .button')['min-height']).toBe('44px')
  })
})
