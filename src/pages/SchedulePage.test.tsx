import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import type * as BellScheduleModule from '../lib/bellSchedule'
import type { DayType, ScheduleEnrollment, SemesterTerm } from '../lib/domain'
import type * as ScheduleImportModule from '../lib/scheduleImport'
import type { ScheduleImportResult } from '../lib/scheduleImport'
import styles from '../styles/features/schedule.css?raw'
import { getCssDeclarations } from '../test/css'
import { SchedulePage } from './SchedulePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  clearSchedule: vi.fn(),
  removeEnrollment: vi.fn(),
  createScheduleShareUrl: vi.fn(),
  confirmScheduleImport: vi.fn(),
  normalizeImportedResultForGrade: vi.fn(),
  resolveBellNow: vi.fn(),
  gridProps: vi.fn(),
  gridMounted: vi.fn(),
  gridUnmounted: vi.fn(),
  addClassProps: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../features/bell/BellScheduleProvider', () => ({
  useBellSchedule: () => ({ days: [], status: 'ready', campus: 'NASH', canChooseCampus: false, setGuestCampus: vi.fn(), retry: vi.fn() }),
}))
vi.mock('../lib/bellSchedule', async (importOriginal) => {
  const actual = await importOriginal<typeof BellScheduleModule>()
  return { ...actual, resolveBellNow: mocks.resolveBellNow }
})
vi.mock('../lib/supabase/data', () => ({
  clearSchedule: mocks.clearSchedule,
  removeEnrollment: mocks.removeEnrollment,
  searchClasses: vi.fn(),
  searchCourseNames: vi.fn(),
  searchGuestClasses: vi.fn(),
  searchGuestCourseNames: vi.fn(),
  updateEnrollmentTerm: vi.fn(),
}))
vi.mock('../lib/scheduleImport', async (importOriginal) => {
  const actual = await importOriginal<typeof ScheduleImportModule>()
  return {
    ...actual,
    confirmScheduleImport: mocks.confirmScheduleImport,
    normalizeImportedResultForGrade: mocks.normalizeImportedResultForGrade,
  }
})
vi.mock('../lib/scheduleShare', () => ({
  createScheduleShareUrl: mocks.createScheduleShareUrl,
  scheduleShareTitle: 'My A/B-Day Schedule | NA ScheduleShare',
}))
vi.mock('../components/schedule/ScheduleGrid', async () => {
  const { useEffect } = await import('react')
  return { ScheduleGrid: (props: { enrollments: Array<{ id?: string; class?: { course_name: string } }>; selectedTerm: SemesterTerm; readOnly?: boolean; todayDayType?: DayType | null; currentPeriod?: number | null; defaultMobileDay?: DayType | null; onAdd: (day: DayType, period: number) => void; onRemove: (enrollment: unknown) => void }) => {
    mocks.gridProps(props)
    // The real grid keeps the phone A/B day in its own state, so a remount loses it.
    useEffect(() => {
      mocks.gridMounted()
      return () => { mocks.gridUnmounted() }
    }, [])
    const { enrollments, onAdd, onRemove } = props
    return <div data-testid="schedule-grid" data-term={props.selectedTerm}>{enrollments.flatMap((enrollment) => enrollment.class ? [<span key={enrollment.id ?? enrollment.class.course_name}>{enrollment.class.course_name}</span>] : [])}<button type="button" onClick={() => onRemove({ id: 'enrollment-test', class: { course_name: 'Test Biology' } })}>Remove test class</button><button type="button" onClick={() => onAdd('B', 6)}>Add test class</button></div>
  } }
})
vi.mock('../components/schedule/TermSelector', () => ({
  TermSelector: ({ value, onChange }: { value: SemesterTerm; onChange: (term: SemesterTerm) => void }) => <div data-testid="term-selector" data-value={value}><button type="button" onClick={() => onChange('semester_1')}>Show Semester 1</button><button type="button" onClick={() => onChange('semester_2')}>Show Semester 2</button></div>,
}))
vi.mock('../components/schedule/AddClassDialog', () => ({
  AddClassDialog: (props: { dayType: DayType; period: number; semester: SemesterTerm }) => {
    mocks.addClassProps(props)
    return <div data-testid="manual-dialog" data-slot={`${props.dayType}${props.period}`} data-semester={props.semester} />
  },
}))
vi.mock('../components/schedule/ScheduleImportDialog', () => ({
  ScheduleImportDialog: ({ onboarding, isGuest, initialResult, clarificationRowIds = [], onClose, onGuestPreview, onNeedsClarification, onClarificationResolved }: { onboarding?: boolean; isGuest?: boolean; initialResult?: ScheduleImportResult | null; clarificationRowIds?: string[]; onClose: () => void; onGuestPreview?: (result: ScheduleImportResult) => void; onNeedsClarification?: (value: { result: ScheduleImportResult; rowIds: string[] }) => void; onClarificationResolved?: () => void }) => clarificationRowIds.length > 0 ? (
    <div data-testid="clarification-dialog">
      <h2>{clarificationRowIds.length} {clarificationRowIds.length === 1 ? 'class needs' : 'classes need'} clarification</h2>
      <span>{initialResult?.rows[0]?.source_course_name}</span>
      <button type="button" onClick={onClose}>Close clarification</button>
      <button type="button" onClick={onClarificationResolved}>Resolve clarification</button>
    </div>
  ) : (
    <div data-testid="import-dialog" data-onboarding={String(Boolean(onboarding))} data-guest={String(Boolean(isGuest))}>
      <span>{onboarding ? 'Automatic onboarding' : 'Manual import'}</span>
      {isGuest ? <button type="button" onClick={() => {
        onGuestPreview?.({
          image_count: 1,
          warnings: [],
          shared_student_count: 4,
          estimated_grade: 10,
          rows: [{
            id: 'guest-row-1',
            source_course_name: 'AP Statistics',
            course: { id: 'course-ap-statistics', name: 'AP Statistics', confidence: 1 },
            teacher_last_name: 'Lester',
            term: 'full_year',
            meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
            confidence: 1,
            warnings: [],
            flags: [],
            resolution: 'new_class',
            existing_class_id: null,
            class_options: [],
          }],
        })
        onClose()
      }}>Show imported schedule</button> : null}
      <button type="button" onClick={() => {
        onNeedsClarification?.({
          rowIds: ['problem-row'],
          result: {
            image_count: 1,
            warnings: [],
            rows: [{
              id: 'problem-row',
              source_course_name: 'Mystery Course',
              course: null,
              teacher_last_name: 'Unknown',
              term: 'unknown',
              meeting_slots: [{ day_type: 'A', period_number: 2 }],
              confidence: 0.4,
              warnings: [],
              flags: ['unresolved_course'],
              resolution: 'unresolved_course',
              existing_class_id: null,
              class_options: [],
            }],
          },
        })
        onClose()
      }}>Complete analysis with issues</button>
      <button type="button" onClick={onClose}>Dismiss import</button>
    </div>
  ),
}))

function emptySchedule() {
  return {
    enrollments: [],
    loading: false,
    error: null,
    reload: vi.fn(async () => undefined),
    addDemoEnrollment: vi.fn(),
    removeDemoEnrollment: vi.fn(),
    updateDemoTerm: vi.fn(),
  }
}

function semesterOneSchedule(): ScheduleEnrollment[] {
  return Array.from({ length: 9 }, (_, index) => {
    const period = index + 1
    const meetingSlots = [{ day_type: 'A' as const, period_number: period }, { day_type: 'B' as const, period_number: period }]
    return {
      id: `enrollment-semester-1-${period}`,
      class_id: `class-semester-1-${period}`,
      student_id: 'student-1',
      academic_term: 'semester_1' as const,
      active: true,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      meeting_slots: meetingSlots,
      class: {
        id: `class-semester-1-${period}`,
        course_name_id: `course-semester-1-${period}`,
        course_name: `Semester 1 Class ${period}`,
        teacher_last_name: `Teacher ${period}`,
        default_academic_term: 'semester_1' as const,
        is_double_period: false,
        meeting_slots: meetingSlots,
      },
    }
  })
}

function pageTree(initialEntry = '/schedule') {
  return <MemoryRouter initialEntries={[initialEntry]}><ToastProvider><SchedulePage /></ToastProvider></MemoryRouter>
}

function renderPage(initialEntry = '/schedule') {
  return render(pageTree(initialEntry))
}

function timedEnrollment(id: string, courseName: string, term: 'full_year' | 'semester_1' | 'semester_2', slots: Array<{ day_type: DayType; period_number: number }>): ScheduleEnrollment {
  return {
    id,
    class_id: `class-${id}`,
    student_id: 'student-1',
    academic_term: term,
    active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    meeting_slots: slots,
    class: { id: `class-${id}`, course_name_id: `course-${id}`, course_name: courseName, teacher_last_name: 'Teacher', default_academic_term: term, is_double_period: false, meeting_slots: slots },
  }
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop browser' })
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn() } })
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isAdmin: false, isDemo: false })
  mocks.useSchedule.mockReturnValue(emptySchedule())
  mocks.createScheduleShareUrl.mockResolvedValue('https://share.example/share/99300000-0000-4000-8000-000000000001')
  mocks.confirmScheduleImport.mockResolvedValue({ added: 1, removed: 0 })
  mocks.clearSchedule.mockResolvedValue(1)
  mocks.normalizeImportedResultForGrade.mockImplementation(async (result) => result)
  mocks.resolveBellNow.mockReturnValue({ day: null, isToday: false, state: 'none', current: null, next: null, targetAt: null, intervalStart: null, remainingMs: null, progressPercent: null })
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SchedulePage onboarding', () => {
  it('automatically opens once for a signed-in student with no saved schedule', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    expect(await screen.findByText('Automatic onboarding')).toBeInTheDocument()
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-onboarding', 'true')
    await user.click(screen.getByRole('button', { name: 'Dismiss import' }))
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()

    first.unmount()
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Add your schedule in about a minute' })).toBeInTheDocument()
  })

  it('shows classmate discovery after the first import until Students has been visited', async () => {
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'See who you share classes with' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find classmates' })).toHaveAttribute('href', '/students')
    expect(screen.queryByRole('heading', { name: 'Share your schedule with friends' })).not.toBeInTheDocument()
  })

  it('shows the sharing prompt after Students has been visited', () => {
    mocks.useAuth.mockReturnValue({
      user: { id: 'student-1' },
      profile: { students_visited_at: '2026-07-23T01:00:00Z' },
      isAdmin: false,
      isDemo: false,
    })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Share your schedule with friends' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'See who you share classes with' })).not.toBeInTheDocument()
  })

  it('remembers when the inline sharing reminder is dismissed', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({
      user: { id: 'student-1' },
      profile: { students_visited_at: '2026-07-23T01:00:00Z' },
      isAdmin: false,
      isDemo: false,
    })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    const first = renderPage()

    await user.click(screen.getByRole('button', { name: 'Dismiss sharing reminder' }))
    expect(screen.queryByRole('heading', { name: 'Share your schedule with friends' })).not.toBeInTheDocument()

    first.unmount()
    renderPage()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Share your schedule with friends' })).not.toBeInTheDocument())
  })

  it('opens the import flow without auto-onboarding from the no-schedule upload URL', async () => {
    renderPage('/schedule?import=1')
    expect(await screen.findByText('Manual import')).toBeInTheDocument()
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-onboarding', 'false')
  })

  it('keeps clarification items reopenable until they are resolved', async () => {
    const user = userEvent.setup()
    renderPage('/schedule?import=1')

    await user.click(await screen.findByRole('button', { name: 'Complete analysis with issues' }))
    const choice = await screen.findByRole('alertdialog', { name: '1 class couldn’t be imported' })
    expect(choice).toHaveTextContent('The rest of your schedule was imported.')
    // Enter on the focused button must not throw the saved clarification away.
    expect(within(choice).getByRole('button', { name: 'Fix it now' })).toHaveFocus()
    expect(screen.queryByTestId('clarification-dialog')).not.toBeInTheDocument()
    await user.click(within(choice).getByRole('button', { name: 'Fix it now' }))
    expect(await screen.findByTestId('clarification-dialog')).toHaveTextContent('1 class needs clarification')
    expect(screen.getByText('Mystery Course')).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:schedule-import-clarification:v1:student-1')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close clarification' }))
    expect(screen.queryByTestId('clarification-dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review classes' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Review classes' }))
    expect(screen.getByTestId('clarification-dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resolve clarification' }))

    expect(screen.queryByRole('button', { name: 'Review classes' })).not.toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:schedule-import-clarification:v1:student-1')).toBeNull()
  })

  it('lets the student dismiss the clarification reminder', async () => {
    const user = userEvent.setup()
    renderPage('/schedule?import=1')

    await user.click(await screen.findByRole('button', { name: 'Complete analysis with issues' }))
    await user.click(await screen.findByRole('button', { name: 'Fix it now' }))
    await user.click(screen.getByRole('button', { name: 'Close clarification' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss clarification reminder' }))

    expect(screen.queryByRole('button', { name: 'Review classes' })).not.toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:schedule-import-clarification:v1:student-1')).toBeNull()
  })

  it('returns to the schedule without opening corrections when manual entry is chosen', async () => {
    const user = userEvent.setup()
    renderPage('/schedule?import=1')

    await user.click(await screen.findByRole('button', { name: 'Complete analysis with issues' }))
    await user.click(await screen.findByRole('button', { name: 'Add it myself' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('clarification-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('schedule-grid')).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:schedule-import-clarification:v1:student-1')).toBeNull()
  })

  it('clears the reminder after every outstanding class was added manually', async () => {
    const clarification = {
      rowIds: ['problem-row'],
      result: {
        image_count: 1,
        warnings: [],
        rows: [{
          id: 'problem-row',
          source_course_name: 'Hon Music Production 3',
          course: { id: 'course-music-production', name: 'Honors Music Production 3', confidence: 1, term_policy: 'semester' as const },
          teacher_last_name: 'Tozier',
          term: 'semester_2' as const,
          meeting_slots: [{ day_type: 'A' as const, period_number: 3 }, { day_type: 'B' as const, period_number: 3 }],
          confidence: 1,
          warnings: [],
          flags: ['incomplete' as const],
          resolution: 'new_class' as const,
          existing_class_id: null,
          class_options: [],
        }],
      },
    }
    localStorage.setItem('scheduleshare:schedule-import-clarification:v1:student-1', JSON.stringify(clarification))
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{
        id: 'enrollment-music-production',
        class_id: 'class-music-production',
        student_id: 'student-1',
        academic_term: 'semester_2',
        active: true,
        created_at: '2026-07-29T00:00:00Z',
        updated_at: '2026-07-29T00:00:00Z',
        meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
        class: {
          id: 'class-music-production',
          course_name_id: 'course-music-production',
          course_name: 'Honors Music Production 3',
          teacher_last_name: 'Tozier',
          default_academic_term: 'semester_2',
          is_double_period: false,
          meeting_slots: [{ day_type: 'A', period_number: 3 }, { day_type: 'B', period_number: 3 }],
        },
      }],
    })

    renderPage()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review classes' })).not.toBeInTheDocument())
    expect(localStorage.getItem('scheduleshare:schedule-import-clarification:v1:student-1')).toBeNull()
  })

  it('lets a logged-out visitor open the importer before creating an account', async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, isDemo: false })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Import screenshot' }))
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-guest', 'true')
    expect(screen.getByRole('heading', { name: 'Import your schedule' })).toBeInTheDocument()
  })

  it('places the reviewed guest import in the schedule grid and shows the account callout', async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, isDemo: false })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Import screenshot' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show imported schedule' }))

    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('schedule-grid')).toHaveTextContent('AP Statistics')
    expect(document.querySelector('.schedule-open-slots-note')).toHaveTextContent('32 open periods across both semesters')
    expect(mocks.gridProps).toHaveBeenLastCalledWith(expect.objectContaining({ readOnly: true }))
    expect(screen.getByRole('heading', { name: 'See who shares classes with you' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'See who shares classes with you' }).closest('section')).toHaveTextContent('4 students share at least one class with you')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:guest-import-draft:v1')).not.toBeNull()
  })

  it('names the only semester with open slots even when the other semester is complete', () => {
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: semesterOneSchedule(),
    })
    renderPage()

    expect(document.querySelector('.schedule-open-slots-note')).toHaveTextContent('18 open periods in Semester 2')
  })

  it('automatically saves a guest preview after account onboarding completes', async () => {
    const schedule = emptySchedule()
    const draft = {
      image_count: 1,
      warnings: [],
      shared_student_count: 4,
      estimated_grade: 10,
      rows: [{
        id: 'guest-row-1',
        source_course_name: 'AP Statistics',
        course: { id: 'course-ap-statistics', name: 'AP Statistics', confidence: 1 },
        teacher_last_name: 'Lester',
        term: 'full_year' as const,
        meeting_slots: [{ day_type: 'A' as const, period_number: 1 }, { day_type: 'B' as const, period_number: 1 }],
        confidence: 1,
        warnings: [],
        flags: [],
        resolution: 'new_class' as const,
        existing_class_id: null,
        class_options: [],
      }],
    }
    localStorage.setItem('scheduleshare:guest-import-draft:v1', JSON.stringify({ saved_at: Date.now(), result: draft }))
    mocks.useAuth.mockReturnValue({
      user: { id: 'student-1' },
      profile: { grade: 10, onboarding_completed: true },
      isAdmin: false,
      isDemo: false,
    })
    mocks.useSchedule.mockReturnValue(schedule)
    renderPage('/schedule')

    await waitFor(() => expect(mocks.confirmScheduleImport).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    expect(mocks.normalizeImportedResultForGrade).toHaveBeenCalledWith(expect.objectContaining({ shared_student_count: 4 }), 10)
    expect(schedule.reload).toHaveBeenCalled()
    expect(await screen.findByText('Your imported schedule was saved: 1 class added.')).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:guest-import-draft:v1')).toBeNull()
  })

  it('removes a class immediately without a confirmation prompt', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    const schedule = {
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-test', student_id: 'student-1', class: { course_name: 'Test Biology' } }],
    }
    mocks.useSchedule.mockReturnValue(schedule)
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove test class' }))
    await waitFor(() => expect(mocks.removeEnrollment).toHaveBeenCalledWith('enrollment-test'))
    expect(confirm).not.toHaveBeenCalled()
    expect(schedule.reload).toHaveBeenCalled()
    expect(await screen.findByText('Test Biology was removed from your schedule.')).toBeInTheDocument()
  })

  it('keeps the page usable and reports a failed class removal', async () => {
    const user = userEvent.setup()
    const schedule = {
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-test', student_id: 'student-1', class: { course_name: 'Test Biology' } }],
    }
    mocks.useSchedule.mockReturnValue(schedule)
    mocks.removeEnrollment.mockRejectedValueOnce(new Error('Class removal is temporarily unavailable.'))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove test class' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Class removal is temporarily unavailable.')
    expect(schedule.reload).not.toHaveBeenCalled()
    expect(screen.getByText('Test Biology')).toBeInTheDocument()
  })

  it('requires confirmation before clearing every class', async () => {
    const user = userEvent.setup()
    const schedule = {
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-test', student_id: 'student-1', class: { course_name: 'Test Biology' } }],
    }
    mocks.useSchedule.mockReturnValue(schedule)
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Clear schedule' }))
    const confirmation = screen.getByRole('dialog', { name: 'Clear your schedule?' })
    expect(confirmation).toHaveAccessibleDescription('This removes your 1 class from your schedule.')
    expect(mocks.clearSchedule).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Clear your schedule?' })).not.toBeInTheDocument()
    expect(mocks.clearSchedule).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Clear schedule' }))
    await user.click(screen.getByRole('button', { name: 'Remove all classes' }))
    await waitFor(() => expect(mocks.clearSchedule).toHaveBeenCalledTimes(1))
    expect(schedule.reload).toHaveBeenCalled()
    expect(await screen.findByText('Schedule cleared: 1 class removed.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Clear your schedule?' })).not.toBeInTheDocument()
  })

  it('opens the native share sheet with only the dedicated URL and title', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(nativeShare).toHaveBeenCalledWith({
      title: 'My A/B-Day Schedule | NA ScheduleShare',
      url: 'https://share.example/share/99300000-0000-4000-8000-000000000001',
    }))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('treats AbortError as the user closing the native share sheet', async () => {
    const nativeShare = vi.fn().mockRejectedValue(new DOMException('Closed', 'AbortError'))
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(nativeShare).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share schedule' })).toBeEnabled())
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies the dedicated link and confirms on browsers without native sharing', async () => {
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://share.example/share/99300000-0000-4000-8000-000000000001',
    ))
    expect(await screen.findByText('Schedule link copied.')).toBeInTheDocument()
  })

  it('copies the link on desktop even when native sharing is available', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://share.example/share/99300000-0000-4000-8000-000000000001',
    ))
    expect(nativeShare).not.toHaveBeenCalled()
  })
  it('confirms a native share and stops showing the sharing reminder', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    mocks.useAuth.mockReturnValue({
      user: { id: 'student-1' },
      profile: { students_visited_at: '2026-07-23T01:00:00Z' },
      isAdmin: false,
      isDemo: false,
    })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share link' }))

    expect(await screen.findByText('Schedule shared.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Share your schedule with friends' })).not.toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:share-cta-dismissed:student-1')).toBe('true')
  })

  it('explains a failed share next to the page actions', async () => {
    mocks.createScheduleShareUrl.mockRejectedValueOnce(new Error('Schedule sharing is not configured yet.'))
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Share schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Schedule sharing is not configured yet.')
    expect(localStorage.getItem('scheduleshare:share-cta-dismissed:student-1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the clear confirmation open and shows the error when clearing fails', async () => {
    const user = userEvent.setup()
    mocks.clearSchedule.mockRejectedValueOnce(new Error('Clearing is temporarily unavailable.'))
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-test', student_id: 'student-1', class: { course_name: 'Test Biology' } }],
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Clear schedule' }))
    await user.click(screen.getByRole('button', { name: 'Remove all classes' }))

    const confirmation = screen.getByRole('dialog', { name: 'Clear your schedule?' })
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Clearing is temporarily unavailable.')
    expect(screen.getByRole('button', { name: 'Remove all classes' })).toBeEnabled()
  })

  it('clears demo schedules locally without calling the server', async () => {
    const user = userEvent.setup()
    const schedule = {
      ...emptySchedule(),
      enrollments: [
        { id: 'enrollment-a', student_id: 'student-1', class: { course_name: 'Biology' } },
        { id: 'enrollment-b', student_id: 'student-1', class: { course_name: 'Chemistry' } },
      ],
    }
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isAdmin: false, isDemo: true })
    mocks.useSchedule.mockReturnValue(schedule)
    renderPage()

    expect(screen.getByRole('button', { name: 'Import screenshot' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear schedule' }))
    expect(screen.getByRole('dialog', { name: 'Clear your schedule?' })).toHaveAccessibleDescription('This removes all 2 classes from your schedule.')
    await user.click(screen.getByRole('button', { name: 'Remove all classes' }))

    expect(schedule.removeDemoEnrollment).toHaveBeenCalledWith('enrollment-a')
    expect(schedule.removeDemoEnrollment).toHaveBeenCalledWith('enrollment-b')
    expect(mocks.clearSchedule).not.toHaveBeenCalled()
    expect(await screen.findByText('Schedule cleared: 2 classes removed.')).toBeInTheDocument()
  })

  it('offers manual entry from the empty schedule and hides schedule-only actions', async () => {
    const user = userEvent.setup()
    localStorage.setItem('scheduleshare:schedule-onboarding:student-1', 'dismissed')
    renderPage()

    expect(screen.queryByRole('button', { name: 'Clear schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share schedule' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enter classes manually' }))
    expect(screen.getByTestId('manual-dialog')).toHaveAttribute('data-slot', 'A1')

    await user.click(screen.getByRole('button', { name: 'Add test class' }))
    expect(mocks.addClassProps).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: 'B', period: 6, semester: 'semester_1' }))
  })

  it('reports a schedule that failed to load and retries it', async () => {
    const schedule = { ...emptySchedule(), error: 'Unable to load the schedule.' }
    mocks.useSchedule.mockReturnValue(schedule)
    localStorage.setItem('scheduleshare:schedule-onboarding:student-1', 'dismissed')
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('Your schedule didn’t load. Unable to load the schedule.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(schedule.reload).toHaveBeenCalled()
  })

  it('names classes scheduled at the same time in the selected semester', async () => {
    const slots = [{ day_type: 'A' as const, period_number: 3 }, { day_type: 'B' as const, period_number: 3 }]
    const enrollment = (id: string, courseName: string, term: 'full_year' | 'semester_1' | 'semester_2') => ({
      id,
      class_id: `class-${id}`,
      student_id: 'student-1',
      academic_term: term,
      active: true,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      meeting_slots: slots,
      class: { id: `class-${id}`, course_name_id: `course-${id}`, course_name: courseName, teacher_last_name: 'Teacher', default_academic_term: term, is_double_period: false, meeting_slots: slots },
    })
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [enrollment('one', 'Chemistry', 'full_year'), enrollment('two', 'Robotics', 'semester_2')],
    })
    renderPage()

    expect(screen.queryByText(/scheduled at the same time/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show Semester 2' }))
    expect(screen.getByText('Chemistry and Robotics are scheduled at the same time.')).toBeInTheDocument()
    expect(screen.getByText(/Open a class marked “Conflict”/)).toBeInTheDocument()
    expect(screen.getByText('Robotics isn’t shown in the grid because it shares a period with Chemistry.')).toBeInTheDocument()
  })

  it('offers edit and remove for a conflicting class the grid cannot show', async () => {
    const user = userEvent.setup()
    const both = [{ day_type: 'A' as const, period_number: 6 }, { day_type: 'B' as const, period_number: 6 }]
    const spanish = timedEnrollment('spanish', 'Honors Spanish 3', 'full_year', both)
    const writing = timedEnrollment('writing', 'Creative Writing', 'semester_1', [{ day_type: 'B', period_number: 6 }, { day_type: 'A', period_number: 6 }])
    const schedule = { ...emptySchedule(), enrollments: [spanish, writing] }
    mocks.useSchedule.mockReturnValue(schedule)
    renderPage()

    expect(screen.getByText('Creative Writing isn’t shown in the grid because it shares a period with Honors Spanish 3.')).toBeInTheDocument()
    expect(screen.queryByText(/Honors Spanish 3 isn’t shown/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit or replace Creative Writing' }))
    expect(mocks.addClassProps).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: 'A', period: 6, semester: 'semester_1', replacing: writing }))

    await user.click(screen.getByRole('button', { name: 'Remove Creative Writing' }))
    await waitFor(() => expect(mocks.removeEnrollment).toHaveBeenCalledWith('writing'))
    expect(schedule.reload).toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Your classes' })).toHaveFocus()
  })

  it('lists no hidden classes when each conflicting class still has a cell', () => {
    const spanish = timedEnrollment('spanish', 'Honors Spanish 3', 'full_year', [{ day_type: 'A', period_number: 6 }, { day_type: 'B', period_number: 6 }])
    const writing = timedEnrollment('writing', 'Creative Writing', 'full_year', [{ day_type: 'A', period_number: 6 }, { day_type: 'B', period_number: 7 }])
    mocks.useSchedule.mockReturnValue({ ...emptySchedule(), enrollments: [spanish, writing] })
    renderPage()

    expect(screen.getByText('Honors Spanish 3 and Creative Writing are scheduled at the same time.')).toBeInTheDocument()
    expect(screen.queryByText(/isn’t shown in the grid/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Creative Writing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Honors Spanish 3' })).not.toBeInTheDocument()
  })

  it('explains a second lunch as a lunch conflict rather than a time clash', () => {
    const lunch = (id: string, courseName: string, period: number) => {
      const slots = [{ day_type: 'A' as const, period_number: period }, { day_type: 'B' as const, period_number: period }]
      return {
        id,
        class_id: `class-${id}`,
        student_id: 'student-1',
        academic_term: 'full_year' as const,
        active: true,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        meeting_slots: slots,
        class: { id: `class-${id}`, course_name_id: `course-${id}`, course_name: courseName, teacher_last_name: 'N/A', default_academic_term: 'full_year' as const, course_term_policy: 'lunch' as const, is_double_period: false, meeting_slots: slots },
      }
    }
    mocks.useSchedule.mockReturnValue({ ...emptySchedule(), enrollments: [lunch('one', 'Lunch - NASH', 5), lunch('two', 'Lunch - NAI', 6)] })
    renderPage()

    expect(screen.getByText('Lunch - NASH and Lunch - NAI are both lunches.')).toBeInTheDocument()
  })

  it('opens on today’s semester and marks today’s day and period in the grid', async () => {
    mocks.resolveBellNow.mockReturnValue({
      day: { date: '2027-02-02', campus: 'NASH', day_type: 'B', semester: 'semester_2', no_school: false, source: 'default', schedule: null },
      isToday: true,
      state: 'in_block',
      current: { position: 4, kind: 'class', label: 'Period 3', period_number: 3, start_time: '09:09', end_time: '09:49' },
      next: null,
      targetAt: null,
      intervalStart: null,
      remainingMs: null,
      progressPercent: null,
    })
    mocks.useSchedule.mockReturnValue({ ...emptySchedule(), enrollments: semesterOneSchedule() })
    renderPage()

    expect(screen.getByTestId('term-selector')).toHaveAttribute('data-value', 'semester_2')
    expect(mocks.gridProps).toHaveBeenLastCalledWith(expect.objectContaining({ selectedTerm: 'semester_2', todayDayType: 'B', currentPeriod: 3, defaultMobileDay: 'B' }))

    await userEvent.click(screen.getByRole('button', { name: 'Show Semester 1' }))
    expect(mocks.gridProps).toHaveBeenLastCalledWith(expect.objectContaining({ selectedTerm: 'semester_1', todayDayType: null, currentPeriod: null, defaultMobileDay: 'B' }))
  })

  it('opens the phone view on the next school day without marking it as today', () => {
    mocks.resolveBellNow.mockReturnValue({
      day: { date: '2026-10-19', campus: 'NASH', day_type: 'A', semester: 'semester_1', no_school: false, source: 'default', schedule: null },
      isToday: false,
      state: 'no_school',
      current: null,
      next: null,
      targetAt: null,
      intervalStart: null,
      remainingMs: null,
      progressPercent: null,
    })
    renderPage()

    expect(mocks.gridProps).toHaveBeenLastCalledWith(expect.objectContaining({ selectedTerm: 'semester_1', todayDayType: null, currentPeriod: null, defaultMobileDay: 'A' }))
  })
})

describe('SchedulePage touch targets', () => {
  it('gives compact callout and notice buttons a 44px target on phones and touch screens', () => {
    expect(styles).toContain('@media (max-width: 639px), (pointer: coarse) {\n  .schedule-callout-actions .button,')
    expect(getCssDeclarations(styles, '.schedule-callout-actions .button, .schedule-error .button, .schedule-conflict-actions .button')).toMatchObject({ 'min-height': '44px' })
  })
})

describe('SchedulePage loading', () => {
  it('shows the skeleton for the first load only and keeps the grid mounted while a save reloads', () => {
    localStorage.setItem('scheduleshare:schedule-onboarding:student-1', 'completed')
    const loaded = { ...emptySchedule(), enrollments: semesterOneSchedule() }
    mocks.useSchedule.mockReturnValue({ ...loaded, enrollments: [], loading: true })
    const view = renderPage()
    expect(screen.getByRole('status', { name: 'Loading your schedule…' })).toBeInTheDocument()
    expect(screen.queryByTestId('schedule-grid')).not.toBeInTheDocument()

    mocks.useSchedule.mockReturnValue(loaded)
    view.rerender(pageTree())
    expect(screen.getByTestId('schedule-grid')).toBeInTheDocument()
    expect(mocks.gridMounted).toHaveBeenCalledTimes(1)

    // An add, edit, removal or import reloads the schedule in the background.
    mocks.useSchedule.mockReturnValue({ ...loaded, loading: true })
    view.rerender(pageTree())
    expect(screen.queryByRole('status', { name: 'Loading your schedule…' })).not.toBeInTheDocument()
    expect(screen.getByTestId('schedule-grid')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your classes' })).toHaveAttribute('aria-busy', 'true')

    mocks.useSchedule.mockReturnValue(loaded)
    view.rerender(pageTree())
    expect(screen.getByRole('region', { name: 'Your classes' })).not.toHaveAttribute('aria-busy')
    expect(mocks.gridMounted).toHaveBeenCalledTimes(1)
    expect(mocks.gridUnmounted).not.toHaveBeenCalled()
  })

  it('shows the skeleton again for the first load after signing in on this page', () => {
    localStorage.setItem('scheduleshare:schedule-onboarding:student-1', 'completed')
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, isDemo: false })
    const view = renderPage()
    expect(screen.queryByRole('status', { name: 'Loading your schedule…' })).not.toBeInTheDocument()

    // The first render after sign-in still carries the guest's settled state.
    mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, profile: null, isAdmin: false, isDemo: false })
    view.rerender(pageTree())
    mocks.useSchedule.mockReturnValue({ ...emptySchedule(), loading: true })
    view.rerender(pageTree())
    expect(screen.getByRole('status', { name: 'Loading your schedule…' })).toBeInTheDocument()

    mocks.useSchedule.mockReturnValue({ ...emptySchedule(), enrollments: semesterOneSchedule() })
    view.rerender(pageTree())
    expect(screen.getByTestId('schedule-grid')).toBeInTheDocument()
  })
})
