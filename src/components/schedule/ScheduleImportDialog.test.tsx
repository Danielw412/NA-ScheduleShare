import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('supports file upload, clipboard paste into the first empty slot, and two previews', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile('first.png'))
    expect(await screen.findByAltText('Schedule screenshot 1 preview')).toBeInTheDocument()

    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile('pasted.png')) })
    expect(await screen.findByAltText('Schedule screenshot 2 preview')).toBeInTheDocument()
    expect(screen.getByText('pasted.png')).toBeInTheDocument()

    fireEvent.paste(window, { clipboardData: clipboardWith(scheduleFile('third.png')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Both screenshot slots are full')
  })

  it('supports drag-and-drop and sends both selected images in one request', async () => {
    const importScreenshots = vi.fn(async () => importResult())
    renderDialog({ importScreenshots })
    const dropZone = screen.getByText('Drop screenshots here').parentElement!
    fireEvent.drop(dropZone, { dataTransfer: { files: [scheduleFile('one.png'), scheduleFile('two.png')] } })
    expect(await screen.findAllByRole('img', { name: /Schedule screenshot/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Review imported classes' }))
    await waitFor(() => expect(importScreenshots).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'one.png' }),
      expect.objectContaining({ name: 'two.png' }),
    ]))
  })

  it('keeps previews visible after a structured rejection so users can replace an image', async () => {
    const user = userEvent.setup()
    renderDialog({ importScreenshots: vi.fn(async () => { throw new Error('The screenshot shows classes but not their period numbers.') }) })
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Review imported classes' }))
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
})

describe('ScheduleImportDialog review and confirmation', () => {
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
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Review imported classes' }))
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
    const course: CourseNameSearchResult = { id: COURSE_ID, course_name: 'AP Statistics', score: 100 }
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
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Review imported classes' }))
    expect(await screen.findByText('Review every class')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace schedule' })).toBeDisabled()

    await user.click(await screen.findByRole('button', { name: 'AP Statistics' }))
    await user.clear(screen.getByLabelText('Teacher last name'))
    await user.type(screen.getByLabelText('Teacher last name'), 'Lester')
    await user.selectOptions(screen.getByLabelText('Academic term'), 'full_year')
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

  it('shows periods and automatically joins an exact existing class after the term is edited', async () => {
    const user = userEvent.setup()
    const existing = {
      id: 'class-existing',
      course_id: COURSE_ID,
      teacher_last_name: 'Lester',
      term: 'full_year' as const,
      meeting_slots: [{ day_type: 'A' as const, period_number: 1 }, { day_type: 'B' as const, period_number: 1 }],
    }
    renderDialog({ importScreenshots: vi.fn(async () => importResult({ term: 'unknown', class_options: [existing] })) })
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Review imported classes' }))
    expect(screen.getByRole('option', { name: 'Use Lester · A Day P1 / B Day P1 · Full Year' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Academic term'), 'full_year')
    await waitFor(() => expect(screen.getByLabelText('Class action')).toHaveValue('class-existing'))
    expect(screen.getByText('Will use an existing class.')).toBeInTheDocument()
  })

  it('replaces a partially filled schedule instead of treating it as a conflict', async () => {
    const user = userEvent.setup()
    renderDialog({ currentEnrollments: [currentEnrollment()] })
    await user.upload(screen.getByLabelText('Choose screenshot 1'), scheduleFile())
    await user.click(screen.getByRole('button', { name: 'Review imported classes' }))
    expect(await screen.findByText('Review every class')).toBeInTheDocument()
    expect(screen.queryByText('Schedule conflict')).not.toBeInTheDocument()
    expect(screen.getByText(/replace the 1 class currently on your schedule/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace schedule' })).toBeEnabled()
  })
})
