import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ScheduleImportModule from '../lib/scheduleImport'
import { SchedulePage } from './SchedulePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  clearSchedule: vi.fn(),
  removeEnrollment: vi.fn(),
  createScheduleShareUrl: vi.fn(),
  confirmScheduleImport: vi.fn(),
  normalizeImportedResultForGrade: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
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
vi.mock('../components/schedule/ScheduleGrid', () => ({ ScheduleGrid: ({ enrollments, onRemove }: { enrollments: Array<{ id?: string; class?: { course_name: string } }>; onRemove: (enrollment: unknown) => void }) => <div data-testid="schedule-grid">{enrollments.flatMap((enrollment) => enrollment.class ? [<span key={enrollment.id ?? enrollment.class.course_name}>{enrollment.class.course_name}</span>] : [])}<button type="button" onClick={() => onRemove({ id: 'enrollment-test', class: { course_name: 'Test Biology' } })}>Remove test class</button></div> }))
vi.mock('../components/schedule/TermSelector', () => ({ TermSelector: () => <div data-testid="term-selector" /> }))
vi.mock('../components/schedule/AddClassDialog', () => ({ AddClassDialog: () => <div data-testid="manual-dialog" /> }))
vi.mock('../components/schedule/ScheduleImportDialog', () => ({
  ScheduleImportDialog: ({ onboarding, isGuest, onClose, onGuestPreview }: { onboarding?: boolean; isGuest?: boolean; onClose: () => void; onGuestPreview?: (result: unknown) => void }) => (
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

function renderPage(initialEntry = '/schedule') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><SchedulePage /></MemoryRouter>)
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
    expect(screen.getByRole('heading', { name: 'See Who You Share Classes With' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find Classmates' })).toHaveAttribute('href', '/students')
    expect(screen.queryByRole('heading', { name: 'Share your Schedule with friends' })).not.toBeInTheDocument()
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

    expect(screen.getByRole('heading', { name: 'Share your Schedule with friends' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'See Who You Share Classes With' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('heading', { name: 'Share your Schedule with friends' })).not.toBeInTheDocument()

    first.unmount()
    renderPage()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Share your Schedule with friends' })).not.toBeInTheDocument())
  })

  it('opens the import flow without auto-onboarding from the no-schedule upload URL', async () => {
    renderPage('/schedule?import=1')
    expect(await screen.findByText('Manual import')).toBeInTheDocument()
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-onboarding', 'false')
  })

  it('lets a logged-out visitor open the importer before creating an account', async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, isDemo: false })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Import schedule' }))
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-guest', 'true')
    expect(screen.getByRole('heading', { name: 'Import your schedule' })).toBeInTheDocument()
  })

  it('places the reviewed guest import in the schedule grid and shows the account callout', async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, isAdmin: false, isDemo: false })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Import schedule' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show imported schedule' }))

    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('schedule-grid')).toHaveTextContent('AP Statistics')
    expect(screen.getByRole('heading', { name: 'See who shares classes with you' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'See who shares classes with you' }).closest('section')).toHaveTextContent('4 students share at least one class with you')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare:guest-import-draft:v1')).not.toBeNull()
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
    expect(await screen.findByRole('status')).toHaveTextContent('Imported schedule saved automatically: 1 class added')
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
    expect(confirmation).toHaveTextContent('Are you sure?')
    expect(mocks.clearSchedule).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Clear your schedule?' })).not.toBeInTheDocument()
    expect(mocks.clearSchedule).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Clear schedule' }))
    await user.click(screen.getByRole('button', { name: 'Yes, clear schedule' }))
    await waitFor(() => expect(mocks.clearSchedule).toHaveBeenCalledTimes(1))
    expect(schedule.reload).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Schedule cleared: 1 class was removed')
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
    expect(screen.getByRole('status')).toHaveTextContent('Schedule link copied')
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
})
