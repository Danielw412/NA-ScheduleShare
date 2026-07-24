import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseNameSearchResult, ScheduleEnrollment } from '../../lib/domain'
import type { EditableScheduleImportRow, ScheduleImportResult } from '../../lib/scheduleImport'
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

function renderDialog(overrides: Partial<ScheduleImportDialogProps> = {}) {
  const props: ScheduleImportDialogProps = {
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
  return { ...render(<ScheduleImportDialog {...props} />), props }
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
    expect(screen.getByText('PNG, JPEG, or WebP · 10 MB maximum each')).toBeInTheDocument()
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
    const dropZone = screen.getByText('Drop, paste, or choose schedule screenshots').closest('.import-drop-zone')!
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

    expect(screen.getByRole('progressbar', { name: 'AI screenshot analysis progress' })).toBeInTheDocument()
    expect(screen.getByText('AI is analyzing your screenshots…')).toBeInTheDocument()
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1100)) })
    expect(screen.queryByText('Checking the schedule again…')).not.toBeInTheDocument()
    expect(screen.getByText('AI is analyzing your screenshots…')).toBeInTheDocument()

    finishImport?.(importResult())
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Review every class')).not.toBeInTheDocument()
  })

  it('can replace and remove individual screenshots before analysis', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), [scheduleFile('one.png'), scheduleFile('two.png')])
    await user.upload(screen.getByLabelText('Replace screenshot 1'), scheduleFile('replacement.png'))
    expect(await screen.findByText('replacement.png')).toBeInTheDocument()
    expect(screen.queryByText('one.png')).not.toBeInTheDocument()

    const secondPreview = screen.getByAltText('Schedule screenshot 2 preview').closest('.import-image-slot')!
    await user.click(secondPreview.querySelector('button')!)
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
    expect(screen.queryByText('Review every class')).not.toBeInTheDocument()
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
    expect(screen.getByText('Choose a screenshot and ScheduleShare will identify your classes.')).toBeInTheDocument()
    expect(screen.getByText('Drop, paste, or choose schedule screenshots')).toBeInTheDocument()
    expect(screen.getByText('Choose screenshot')).toBeInTheDocument()
    expect(screen.getByLabelText('Schedule import steps')).toHaveTextContent('Screenshot→Review classes→Find classmates')

    await user.click(screen.getByRole('button', { name: 'Enter Schedule Manually' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onManualEntry).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /do this later/i }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('ScheduleImportDialog review and confirmation', () => {
  it('summarizes retried imports without showing the schedule replacement notice', async () => {
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
    renderDialog({
      currentEnrollments: [currentEnrollment()],
      importScreenshots: vi.fn(async () => result),
    })

    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    expect(await screen.findByText('The AI was run twice and 2 imported classes are unresolved or incomplete.')).toBeInTheDocument()
    expect(screen.queryByText(/Gemini checked the screenshots again/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Confirming will replace/)).not.toBeInTheDocument()
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
    expect(screen.queryByText('Your imported schedule')).not.toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: 'Show imported schedule' }))

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
      importScreenshots: vi.fn(async () => importResult({
        course: null,
        resolution: 'unresolved_course',
        flags: ['unresolved_course'],
        teacher_last_name: 'Unknown',
        term: 'unknown',
      })),
      searchCourses: vi.fn(async () => [course]),
      confirmImport,
    })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    expect(await screen.findByText('Review every class')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace schedule' })).toBeDisabled()

    await user.click(await screen.findByRole('button', { name: 'AP Statistics' }))
    await user.clear(screen.getByLabelText('Teacher last name'))
    await user.type(screen.getByLabelText('Teacher last name'), 'Lester')
    expect(screen.getByText('Full-credit and unlisted courses are full year.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'A Day, Period 2' }))
    expect(screen.getByText(/Will propose a new class for existing course “AP Statistics”/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Replace schedule' }))
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

  it('collapses high-confidence reviewed rows while keeping problematic rows expanded', async () => {
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
    renderDialog({ importScreenshots: vi.fn(async () => result) })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    expect(screen.getByRole('button', { name: /AP Statistics.*Full Year.*Create class/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Mystery Course.*Low confidence.*Course unresolved/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Catalogue course for Mystery Course')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByLabelText('Catalogue course for AP Statistics (CHS)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse reviewed' }))
    expect(screen.queryByLabelText('Catalogue course for AP Statistics (CHS)')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Catalogue course for Mystery Course')).toBeInTheDocument()
  })

  it('keeps an 80%-confidence extraction in review', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 0 }))
    renderDialog({
      confirmImport,
      importScreenshots: vi.fn(async () => importResult({ confidence: 0.8 })),
    })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))

    expect(await screen.findByText('Review every class')).toBeInTheDocument()
    expect(confirmImport).not.toHaveBeenCalled()
  })

  it('automatically replaces a partially filled schedule instead of treating it as a conflict', async () => {
    const user = userEvent.setup()
    const confirmImport = vi.fn(async () => ({ added: 1, removed: 1 }))
    renderDialog({ currentEnrollments: [currentEnrollment()], confirmImport })
    await user.upload(screen.getByLabelText('Choose schedule screenshots'), scheduleFile())
    await user.click(screen.getByRole('button', { name: /^Analyze screenshots?$/ }))
    await waitFor(() => expect(confirmImport).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Schedule conflict')).not.toBeInTheDocument()
    expect(screen.queryByText('Review every class')).not.toBeInTheDocument()
  })
})
