import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SchedulePage } from './SchedulePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  removeEnrollment: vi.fn(),
  createScheduleShareUrl: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({ removeEnrollment: mocks.removeEnrollment, updateEnrollmentTerm: vi.fn() }))
vi.mock('../lib/scheduleShare', () => ({
  createScheduleShareUrl: mocks.createScheduleShareUrl,
  scheduleShareTitle: 'My A/B-Day Schedule | NA ScheduleShare',
}))
vi.mock('../components/schedule/ScheduleGrid', () => ({ ScheduleGrid: ({ onRemove }: { onRemove: (enrollment: unknown) => void }) => <div data-testid="schedule-grid"><button type="button" onClick={() => onRemove({ id: 'enrollment-test', class: { course_name: 'Test Biology' } })}>Remove test class</button></div> }))
vi.mock('../components/schedule/TermSelector', () => ({ TermSelector: () => <div data-testid="term-selector" /> }))
vi.mock('../components/schedule/AddClassDialog', () => ({ AddClassDialog: () => <div data-testid="manual-dialog" /> }))
vi.mock('../components/schedule/ScheduleImportDialog', () => ({
  ScheduleImportDialog: ({ onboarding, onClose }: { onboarding?: boolean; onClose: () => void }) => (
    <div data-testid="import-dialog" data-onboarding={String(Boolean(onboarding))}>
      <span>{onboarding ? 'Automatic onboarding' : 'Manual import'}</span>
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

  it('does not show onboarding when a schedule already exists and offers classmate discovery', async () => {
    mocks.useSchedule.mockReturnValue({
      ...emptySchedule(),
      enrollments: [{ id: 'enrollment-1', student_id: 'student-1' }],
    })
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'See Who You Share Classes With' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find Classmates' })).toHaveAttribute('href', '/classmates')
    expect(screen.getByRole('heading', { name: 'Share your Schedule with friends' })).toBeInTheDocument()
  })

  it('remembers when the inline sharing reminder is dismissed', async () => {
    const user = userEvent.setup()
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
