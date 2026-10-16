import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui/Toast'
import { BellScheduleProvider } from '../features/bell/BellScheduleProvider'
import { resetHomepageLayoutCache } from '../features/home/useHomepageLayout'
import { easternLocalTime } from '../lib/bellSchedule'
import type { ScheduleEnrollment, SchoolDayContext } from '../lib/domain'
import { HomePage } from './HomePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  getHomepageStatistic: vi.fn(),
  getHomepageLayout: vi.fn(),
  getMyBellScheduleWindow: vi.fn(),
  getGuestBellScheduleWindow: vi.fn(),
  createScheduleShareUrl: vi.fn(),
  openClubDialog: vi.fn(),
  useClubPrompt: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../components/club/ClubPromptProvider', () => ({ useClubPrompt: mocks.useClubPrompt }))
vi.mock('../lib/supabase/data', () => ({
  getHomepageStatistic: mocks.getHomepageStatistic,
  getHomepageLayout: mocks.getHomepageLayout,
  getMyBellScheduleWindow: mocks.getMyBellScheduleWindow,
  getGuestBellScheduleWindow: mocks.getGuestBellScheduleWindow,
}))
vi.mock('../lib/scheduleShare', () => ({
  createScheduleShareUrl: mocks.createScheduleShareUrl,
  scheduleShareTitle: 'My A/B-Day Schedule | NA ScheduleShare',
}))

function renderPage(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <BellScheduleProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/students" element={<h1>Students destination</h1>} />
          </Routes>
        </BellScheduleProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

function enrollment(courseName: string, period: number): ScheduleEnrollment {
  const slots = [{ day_type: 'A' as const, period_number: period }]
  return {
    id: `${courseName}-enrollment`, class_id: `${courseName}-class`, student_id: 'student-1', academic_term: 'full_year', active: true,
    created_at: '', updated_at: '', meeting_slots: slots,
    class: { id: `${courseName}-class`, course_name_id: `${courseName}-course`, course_name: courseName, teacher_last_name: 'Teacher', default_academic_term: 'full_year', is_double_period: false, meeting_slots: slots },
  }
}

function completeSchedule() {
  return Array.from({ length: 9 }, (_, index) => ({
    active: true,
    class: {
      meeting_slots: [
        { day_type: 'A', period_number: index + 1 },
        { day_type: 'B', period_number: index + 1 },
      ],
    },
  }))
}

function schoolDay(date = '2026-08-24', campus: 'NASH' | 'NAI' = 'NASH'): SchoolDayContext {
  return {
    date, campus, day_type: 'A', semester: 'semester_1', no_school: false, source: 'default',
    schedule: {
      id: 'regular', schedule_key: 'regular', display_name: 'Regular', campus_scope: 'BOTH', warning_time: '07:24', is_builtin: true, archived_at: null, updated_at: '',
      blocks: [
        { position: 1, kind: 'class', label: 'Period 1', period_number: 1, start_time: '07:28', end_time: '08:08' },
        { position: 2, kind: 'non_class', label: 'Homeroom', period_number: null, start_time: '08:08', end_time: '08:21' },
        { position: 3, kind: 'class', label: 'Period 2', period_number: 2, start_time: '08:25', end_time: '09:05' },
      ],
    },
  }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  resetHomepageLayoutCache()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(easternLocalTime('2026-08-24', '07:48'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop browser' })
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  mocks.useAuth.mockReturnValue({ user: null, isDemo: false, loading: false })
  mocks.useSchedule.mockReturnValue({ enrollments: [], loading: false })
  mocks.getHomepageStatistic.mockResolvedValue(null)
  mocks.getHomepageLayout.mockResolvedValue('balanced')
  mocks.getMyBellScheduleWindow.mockResolvedValue([schoolDay()])
  mocks.getGuestBellScheduleWindow.mockResolvedValue([schoolDay()])
  mocks.createScheduleShareUrl.mockResolvedValue('https://share.example/share/99300000-0000-4000-8000-000000000001')
  mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function signIn(enrollments: unknown[] = [], loading = false) {
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false, loading: false, profile: { id: 'student-1', full_name: 'Jordan Smith', grade: 11 } })
  mocks.useSchedule.mockReturnValue({ enrollments, loading })
}

describe('HomePage balanced layout', () => {
  it('introduces ScheduleShare to a guest and links into the main features', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Find out who’s in your classes.' })).toBeInTheDocument()
    expect(screen.getByText('Upload a picture of your schedule, find classmates, and share schedules with friends.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload my schedule' })).toHaveAttribute('href', '/schedule')
    expect(screen.getByRole('link', { name: "Why we're better than Saturn" })).toHaveAttribute('href', '/why-scheduleshare')
    expect(screen.getByRole('link', { name: /Schedule Engine/ })).toHaveAttribute('href', '/schedule-engine')
    expect(screen.getByText('Want classes with friends? See what your schedule would look like if you replace courses.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join the NA Computer and AI Club' })).not.toBeInTheDocument()
  })

  it('greets a signed-in student and starts them on their schedule', async () => {
    signIn()
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: /Good morning, Jordan/ })).toBeInTheDocument()
    expect(screen.getByText('Monday, August 24 is an A day.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start your schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload my schedule' })).toHaveAttribute('href', '/schedule')
    expect(screen.getByRole('button', { name: 'Join the NA Computer and AI Club' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: "Why we're better than Saturn" })).not.toBeInTheDocument()
  })

  it('shows the live bell as one line that opens the bell schedule', async () => {
    signIn([enrollment('AP Psychology', 1)])
    renderPage()
    const strip = await screen.findByRole('link', { name: /AP Psychology/ })
    expect(strip).toHaveAttribute('href', '/bell')
    expect(strip).toHaveTextContent('Period 1, ends at 8:08 AM')
    expect(strip).toHaveTextContent('20:00')
    expect(mocks.getMyBellScheduleWindow).toHaveBeenCalledWith('2026-08-24', 21)
    expect(mocks.getGuestBellScheduleWindow).not.toHaveBeenCalled()
  })

  it('tells a student in a free period when their next class starts', async () => {
    signIn([enrollment('Chemistry', 2)])
    renderPage()
    const strip = await screen.findByRole('link', { name: /Period 1/ })
    expect(strip).toHaveTextContent('No class now. Chemistry starts at 8:25 AM')
  })

  it('does not show an incorrect schedule action while the signed-in schedule is loading', async () => {
    signIn([], true)
    renderPage()
    expect(await screen.findByLabelText('Your schedule')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('link', { name: 'Upload my schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Finish your schedule' })).not.toBeInTheDocument()
  })

  it('counts filled periods for a partial schedule', async () => {
    signIn([enrollment('AP Psychology', 1)])
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Finish your schedule' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 18 periods are filled in/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/schedule')
  })

  it('sends students with a complete schedule to classmates and copies a share link', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    signIn(completeSchedule())
    renderPage()

    expect(await screen.findByRole('link', { name: 'Find classmates' })).toHaveAttribute('href', '/students')
    expect(screen.getByRole('heading', { name: 'Your schedule is complete' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(mocks.createScheduleShareUrl).toHaveBeenCalled())
    expect(await screen.findByText('Schedule link copied.')).toBeInTheDocument()
  })

  it('uses the native share sheet for complete schedules on mobile devices', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    signIn(completeSchedule())
    renderPage()

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await screen.findByRole('button', { name: 'Share schedule' }))

    await waitFor(() => expect(nativeShare).toHaveBeenCalledWith({
      title: 'My A/B-Day Schedule | NA ScheduleShare',
      url: 'https://share.example/share/99300000-0000-4000-8000-000000000001',
    }))
    expect(await screen.findByText('Schedule shared.')).toBeInTheDocument()
  })

  it('shows the homepage statistic to signed-in students too', async () => {
    mocks.getHomepageStatistic.mockResolvedValue({ statistic_key: 'students_joined', activity_scope: 'total', statistic_value: 812, statistic_label: 'students have joined' })
    signIn()
    renderPage()
    expect(await screen.findByText('812')).toBeInTheDocument()
  })

  it('renders only the real statistic returned by the database', async () => {
    mocks.getHomepageStatistic.mockResolvedValue({
      statistic_key: 'class_connections',
      activity_scope: 'total',
      statistic_value: 1240,
      statistic_label: 'class connections found',
    })
    renderPage()
    expect(await screen.findByText('1,240')).toBeInTheDocument()
    expect(screen.getByText(/class connections found/)).toBeInTheDocument()
  })

  it('hides the Why ScheduleShare link when an administrator takes down the page', async () => {
    mocks.useClubPrompt.mockReturnValue({ openClubDialog: mocks.openClubDialog, whyScheduleShareEnabled: false })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Find out who’s in your classes.' })
    expect(screen.queryByRole('link', { name: "Why we're better than Saturn" })).not.toBeInTheDocument()
  })

  it('returns a newly signed-in student to the page they were trying to reach', async () => {
    sessionStorage.setItem('scheduleshare:auth-destination', '/students')
    signIn()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Students destination' })).toBeInTheDocument()
    expect(sessionStorage.getItem('scheduleshare:auth-destination')).toBeNull()
  })
})

describe('HomePage bell-focused layout', () => {
  beforeEach(() => {
    mocks.getHomepageLayout.mockResolvedValue('bell_schedule')
  })

  it('leads with the current period, countdown, progress, and the full day', async () => {
    signIn([enrollment('AP Psychology', 1)])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Monday, August 24' })).toBeInTheDocument()
    const board = screen.getByRole('region', { name: 'Period 1' })
    expect(board).toHaveTextContent('AP Psychology')
    expect(board).toHaveTextContent('20:00')
    expect(board).toHaveTextContent('Ends at 8:08 AM.')
    const progress = within(board).getByRole('progressbar', { name: 'Period 1 progress' })
    expect(progress).toHaveAttribute('aria-valuenow', '50')
    expect(within(board).getByText('Homeroom')).toBeInTheDocument()

    const timeline = screen.getByRole('list', { name: 'Today bell schedule' })
    const rows = within(timeline).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute('aria-current', 'time')
    expect(rows[0]).toHaveTextContent('AP Psychology')
    expect(rows[2]).toHaveTextContent('No class')
    expect(screen.getByRole('heading', { name: 'Finish your schedule' })).toBeInTheDocument()
  })

  it('points a student in a free period at their own next class', async () => {
    signIn([enrollment('Chemistry', 2)])
    renderPage()
    const board = await screen.findByRole('region', { name: 'Period 1' })
    expect(board).toHaveTextContent('Your next class')
    expect(board).toHaveTextContent('Chemistry')
    expect(board).toHaveTextContent('Starts in 37:00')
    expect(board).not.toHaveTextContent('Then')
  })

  it('names a non-class block and counts down to its end', async () => {
    vi.setSystemTime(easternLocalTime('2026-08-24', '08:10'))
    signIn([enrollment('AP Psychology', 1)])
    renderPage()
    const board = await screen.findByRole('region', { name: 'Homeroom' })
    expect(board).toHaveTextContent('11:00')
    expect(board).toHaveTextContent('Ends at 8:21 AM.')
  })

  it('never shows class names to a guest and lets them choose a campus', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.getGuestBellScheduleWindow.mockImplementation(async (date: string, _days: number, campus: 'NASH' | 'NAI') => [schoolDay(date, campus)])
    renderPage()

    expect(await screen.findByRole('region', { name: 'Period 1' })).toHaveTextContent('20:00')
    expect(mocks.getGuestBellScheduleWindow).toHaveBeenCalledWith('2026-08-24', 21, 'NASH')
    expect(screen.queryByText(/AP Psychology/)).not.toBeInTheDocument()
    expect(screen.queryByText('No class')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Find out who’s in your classes.' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'NAI' }))
    await waitFor(() => expect(mocks.getGuestBellScheduleWindow).toHaveBeenLastCalledWith('2026-08-24', 21, 'NAI'))
    expect(localStorage.getItem('scheduleshare.bell-campus')).toBe('NAI')
    expect(await screen.findByText('NAI', { selector: '.chip' })).toBeInTheDocument()
  })

  it('shows the next school day after dismissal and keeps today’s A/B day', async () => {
    vi.setSystemTime(easternLocalTime('2026-08-24', '15:30'))
    mocks.getMyBellScheduleWindow.mockResolvedValue([schoolDay('2026-08-24'), { ...schoolDay('2026-08-25'), day_type: 'B' }])
    signIn()
    renderPage()
    const board = await screen.findByRole('region', { name: 'School’s out' })
    expect(board).toHaveTextContent('Next school day is tomorrow, starting at 7:28 AM')
    expect(screen.getByRole('heading', { name: 'Tomorrow’s bells' })).toBeInTheDocument()
    expect(screen.getByText('A day', { selector: '.chip' })).toBeInTheDocument()
    expect(screen.queryByText('No school today')).not.toBeInTheDocument()
  })

  it('names the next school day by date during a long break', async () => {
    vi.setSystemTime(easternLocalTime('2026-12-23', '10:00'))
    mocks.getMyBellScheduleWindow.mockResolvedValue([{ ...schoolDay('2026-12-23'), no_school: true, schedule: null, day_type: null }, schoolDay('2027-01-04')])
    signIn()
    renderPage()
    const board = await screen.findByRole('region', { name: 'No school today' })
    expect(board).toHaveTextContent('Next school day is Monday, January 4, starting at 7:28 AM')
    expect(screen.getByRole('heading', { name: 'Bells on Monday, January 4' })).toBeInTheDocument()
    expect(screen.getByText('No school today', { selector: '.chip' })).toBeInTheDocument()
  })

  it('does not claim "No class" when the calendar has no A/B day', async () => {
    mocks.getMyBellScheduleWindow.mockResolvedValue([{ ...schoolDay(), day_type: null }])
    signIn([enrollment('AP Psychology', 1), enrollment('Chemistry', 2)])
    renderPage()
    const board = await screen.findByRole('region', { name: 'Period 1' })
    expect(board).toHaveTextContent('20:00')
    expect(screen.queryByText('No class')).not.toBeInTheDocument()
  })

  it('pauses the one-second countdown in a hidden tab and recomputes when visible', async () => {
    signIn([enrollment('AP Psychology', 1)])
    renderPage()
    const board = await screen.findByRole('region', { name: 'Period 1' })
    expect(board).toHaveTextContent('20:00')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    vi.setSystemTime(easternLocalTime('2026-08-24', '07:50'))
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(board).toHaveTextContent('20:00')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(board).toHaveTextContent('17:57')
  })

  it('offers a retry when the bounded bell schedule request fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mocks.getMyBellScheduleWindow.mockRejectedValueOnce(new Error('network'))
    signIn()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('The bell schedule didn’t load.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Period 1' })).toBeInTheDocument()
    expect(mocks.getMyBellScheduleWindow).toHaveBeenCalledTimes(2)
  })
})

describe('HomePage layout setting', () => {
  it('waits for the administrator layout on a first visit instead of flashing the wrong layout', async () => {
    let resolveLayout: (layout: string) => void = () => undefined
    mocks.getHomepageLayout.mockReturnValue(new Promise((resolve) => { resolveLayout = resolve }))
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading home' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    await act(async () => { resolveLayout('bell_schedule') })
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday, August 24' })).toBeInTheDocument()
    expect(localStorage.getItem('scheduleshare.homepage-layout')).toBe('bell_schedule')
  })

  it('renders the last known layout immediately on return visits', async () => {
    localStorage.setItem('scheduleshare.homepage-layout', 'bell_schedule')
    mocks.getHomepageLayout.mockReturnValue(new Promise(() => undefined))
    renderPage()
    expect(screen.queryByRole('status', { name: 'Loading home' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday, August 24' })).toBeInTheDocument()
  })

  it('falls back to the balanced layout when the setting cannot be read', async () => {
    mocks.getHomepageLayout.mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Find out who’s in your classes.' })).toBeInTheDocument()
  })
})
