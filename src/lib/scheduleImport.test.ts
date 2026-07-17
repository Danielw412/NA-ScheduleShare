import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableScheduleImportRow, ImportClassOption } from './scheduleImport'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  searchClasses: vi.fn(),
}))

vi.mock('./supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
}))
vi.mock('./supabase/data', () => ({
  searchClasses: mocks.searchClasses,
}))

import {
  confirmScheduleImport,
  importClassOptionLabel,
  normalizeReviewTerm,
  reconcileExactClassSelection,
} from './scheduleImport'

const option: ImportClassOption = {
  id: 'class-existing',
  course_id: '11111111-1111-4111-8111-111111111111',
  teacher_last_name: 'Lester',
  term: 'full_year',
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
}

const row: EditableScheduleImportRow = {
  id: 'import-1',
  source_course_name: 'AP Statistics (CHS)',
  course: { id: option.course_id, name: 'AP Statistics', confidence: 0.98 },
  teacher_last_name: 'Lester',
  term: 'full_year',
  meeting_slots: option.meeting_slots,
  confidence: 0.97,
  warnings: [],
  flags: [],
  resolution: 'new_class',
  existing_class_id: null,
  selected_existing_class_id: null,
  class_options: [option],
  include: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: [{ added_count: 1, removed_count: 2 }], error: null })
})

describe('schedule import replacement', () => {
  it('defaults blank, missing, unknown, and not-visible review terms to Full Year', () => {
    expect([undefined, null, '', 'unknown', 'not visible', 'not-visible', 'unexpected'].map(normalizeReviewTerm)).toEqual([
      'full_year', 'full_year', 'full_year', 'full_year', 'full_year', 'full_year', 'full_year',
    ])
  })

  it('preserves explicit semester terms and common PowerSchool spellings', () => {
    expect(['semester_1', 'SEM 1', 'Semester 1', 'S1'].map(normalizeReviewTerm)).toEqual(Array(4).fill('semester_1'))
    expect(['semester_2', 'SEM 2', 'Semester 2', 'S2'].map(normalizeReviewTerm)).toEqual(Array(4).fill('semester_2'))
  })

  it('sends all included rows to one atomic replacement RPC', async () => {
    await expect(confirmScheduleImport([row, { ...row, id: 'excluded', include: false }])).resolves.toEqual({ added: 1, removed: 2 })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('replace_schedule_from_import', {
      p_rows: [{
        existing_class_id: null,
        course_name_id: row.course?.id,
        teacher_last_name: 'Lester',
        academic_term: 'full_year',
        meeting_slots: row.meeting_slots,
      }],
    })
  })

  it('reselects an exact existing class after review fields change and labels it with periods', () => {
    const reconciled = reconcileExactClassSelection({ ...row, term: 'full_year' })
    expect(reconciled).toMatchObject({ selected_existing_class_id: option.id, resolution: 'existing_class' })
    expect(importClassOptionLabel(option)).toBe('Use Lester · A Day P1 / B Day P1 · Full Year')
  })

  it('clears a stale incomplete flag after every required field is valid', () => {
    const reconciled = reconcileExactClassSelection({ ...row, flags: ['incomplete'] })
    expect(reconciled.flags).not.toContain('incomplete')
  })

  it('keeps the incomplete flag while the row still fails validation', () => {
    const reconciled = reconcileExactClassSelection({ ...row, term: 'unknown', flags: ['incomplete'] })
    expect(reconciled.flags).toContain('incomplete')
  })

  it('maps database replacement conflicts to a reviewable message', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'import_schedule_conflict' } })
    await expect(confirmScheduleImport([row])).rejects.toThrow('imported classes conflict with each other')
  })

  it('rejects a replacement response that did not add every reviewed row', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ added_count: 0, removed_count: 2 }], error: null })
    await expect(confirmScheduleImport([row])).rejects.toThrow('reported 0 of 1 reviewed classes')
  })

  it('sends Lunch and Study Hall with teacher N/A', async () => {
    await confirmScheduleImport([{
      ...row,
      course: { id: '22222222-2222-4222-8222-222222222222', name: 'Lunch', confidence: 1 },
      teacher_last_name: 'Staff',
    }])
    expect(mocks.rpc).toHaveBeenCalledWith('replace_schedule_from_import', {
      p_rows: [expect.objectContaining({ teacher_last_name: 'N/A' })],
    })
  })
})
