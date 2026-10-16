import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassesPage } from './ClassesPage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
  useClassSearch: vi.fn(),
  getClassMembers: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../hooks/useClassSearch', () => ({ useClassSearch: mocks.useClassSearch }))
vi.mock('../lib/supabase/data', () => ({ searchClasses: vi.fn(), searchGuestClasses: vi.fn(), getClassMembers: mocks.getClassMembers }))

const ownClass = {
  id: 'class-own',
  course_name_id: 'course-own',
  course_name: 'My Biology',
  course_term_policy: 'full_year' as const,
  teacher_last_name: 'Green',
  default_academic_term: 'full_year' as const,
  is_double_period: false,
  meeting_slots: [{ day_type: 'A' as const, period_number: 1 }],
}

const otherClass = {
  id: 'class-other',
  course_name_id: 'course-other',
  course_name: 'Other Chemistry',
  course_term_policy: 'full_year' as const,
  teacher_last_name: 'Blue',
  default_academic_term: 'full_year' as const,
  is_double_period: false,
  meeting_slots: [{ day_type: 'B' as const, period_number: 2 }],
  score: 90,
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isDemo: false })
  mocks.useSchedule.mockReturnValue({
    loading: false,
    enrollments: [{ id: 'enrollment-1', active: true, academic_term: 'full_year', meeting_slots: ownClass.meeting_slots, class: ownClass }],
  })
  mocks.useClassSearch.mockReturnValue({ loading: false, error: null, results: [{ ...ownClass, score: 100 }, otherClass] })
  mocks.getClassMembers.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ClassesPage organization', () => {
  it('lists active classes first and removes them from Other Classes', () => {
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)
    expect(mocks.useClassSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }), expect.any(Object))
    expect(screen.getByRole('heading', { name: 'Your classes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other classes' })).toBeInTheDocument()
    expect(screen.getAllByText('My Biology')).toHaveLength(1)
    expect(screen.getAllByText('Other Chemistry')).not.toHaveLength(0)
  })

  it('orders your classes by period and then A/B day to match the schedule grid', () => {
    mocks.useSchedule.mockReturnValue({
      loading: false,
      enrollments: [
        { id: 'enrollment-late', active: true, class: { ...otherClass, id: 'late-class', course_name: 'Late Class', meeting_slots: [{ day_type: 'B', period_number: 4 }] } },
        { id: 'enrollment-b', active: true, class: { ...otherClass, id: 'b-class', course_name: 'B Day Class', meeting_slots: [{ day_type: 'B', period_number: 1 }] } },
        { id: 'enrollment-a', active: true, class: { ...ownClass, id: 'a-class', course_name: 'A Day Class', meeting_slots: [{ day_type: 'A', period_number: 1 }] } },
      ],
    })

    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)

    const section = screen.getByRole('heading', { name: 'Your classes' }).closest('section')
    expect(section).not.toBeNull()
    expect([...section!.querySelectorAll('.period-numeral')].map((numeral) => numeral.textContent)).toEqual(['Period 1', 'Period 4'])
    expect(within(section!).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('A Day Class'),
      expect.stringContaining('B Day Class'),
      expect.stringContaining('Late Class'),
    ])
  })

  it('shows the upload prompt when the student has no classes', () => {
    mocks.useSchedule.mockReturnValue({ loading: false, enrollments: [] })
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)
    expect(screen.getByText('You have not joined any classes yet. Upload your schedule to find and join your classes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload schedule' })).toHaveAttribute('href', '/schedule?import=1')
  })

  it('groups same-name sections across teachers and reveals their periods on demand', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      loading: false,
      error: null,
      results: [
        { ...ownClass, score: 100 },
        { ...otherClass, id: 'biology-spak', course_name: 'AP Biology', teacher_last_name: 'Spak', meeting_slots: [{ day_type: 'A', period_number: 2 }] },
        { ...otherClass, id: 'biology-allen', course_name: 'AP Biology', teacher_last_name: 'Allen', meeting_slots: [{ day_type: 'B', period_number: 8 }, { day_type: 'B', period_number: 9 }] },
      ],
    })
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)

    const group = screen.getByRole('button', { name: /AP Biology\s*2 periods/ })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Spak')).not.toBeInTheDocument()

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Spak')).toBeInTheDocument()
    expect(screen.getByText('Allen')).toBeInTheDocument()
    const allenRow = screen.getByText('Allen').closest('a') as HTMLElement
    expect(allenRow).toHaveAttribute('href', '/classes/biology-allen')
    expect(within(allenRow).getByText('B day')).toBeInTheDocument()
    expect(within(allenRow).getByText('Periods 8–9')).toBeInTheDocument()
  })

  it('allows the active class group to collapse after a period is selected', async () => {
    const user = userEvent.setup()
    mocks.useClassSearch.mockReturnValue({
      loading: false,
      error: null,
      results: [
        { ...ownClass, score: 100 },
        { ...otherClass, id: 'biology-spak', course_name: 'AP Biology', teacher_last_name: 'Spak' },
        { ...otherClass, id: 'biology-allen', course_name: 'AP Biology', teacher_last_name: 'Allen' },
      ],
    })
    render(<MemoryRouter initialEntries={['/classes/biology-spak']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    const group = await screen.findByRole('button', { name: /AP Biology\s*2 periods/ })
    const groupSection = group.closest('.classes-course') as HTMLElement
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(within(groupSection).getByText('Spak')).toBeInTheDocument()

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(within(groupSection).queryByText('Spak')).not.toBeInTheDocument()
  })

  it('shows real class search results but keeps rosters locked for logged-out visitors', () => {
    mocks.useAuth.mockReturnValue({ user: null, isDemo: false })
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)
    expect(screen.queryByRole('heading', { name: 'Your classes' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Other Chemistry')).not.toHaveLength(0)
    expect(screen.getByText(/Create an account and add your schedule to see who is in this class/)).toBeInTheDocument()
    expect(mocks.getClassMembers).not.toHaveBeenCalled()
  })

  it('filters by day and period and clears both at once', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/classes']}><ClassesPage /></MemoryRouter>)

    expect(screen.getByRole('searchbox', { name: 'Search classes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Day'), 'A')
    await user.selectOptions(screen.getByLabelText('Period'), '2')
    expect(screen.getByLabelText('Day')).toHaveValue('A')
    expect(screen.getByLabelText('Period')).toHaveValue('2')
    expect(mocks.useClassSearch).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: 'A', period: 2 }), expect.any(Object))
    expect(screen.getByText('None of your classes match these filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByLabelText('Day')).toHaveValue('')
    expect(screen.getByLabelText('Period')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    expect(mocks.useClassSearch).toHaveBeenLastCalledWith(expect.objectContaining({ dayType: undefined, period: undefined }), expect.any(Object))
  })

  it('does not show a stale roster after navigating to another class', async () => {
    const user = userEvent.setup()
    let resolveOther!: (members: Array<Record<string, unknown>>) => void
    let resolveOwn!: (members: Array<Record<string, unknown>>) => void
    mocks.getClassMembers.mockImplementation((classId: string) => new Promise((resolve) => {
      if (classId === 'class-other') resolveOther = resolve
      else resolveOwn = resolve
    }))
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    expect(await screen.findByRole('status')).toHaveTextContent('Loading students')
    await user.click(screen.getByRole('link', { name: /My Biology/ }))

    await act(async () => {
      resolveOwn([{ student_id: 'student-current', full_name: 'Current Student', grade: 11, privacy_setting: 'school', can_view_schedule: true }])
    })
    expect(await screen.findByText('Current Student')).toBeInTheDocument()

    await act(async () => {
      resolveOther([{ student_id: 'student-stale', full_name: 'Stale Student', grade: 11, privacy_setting: 'school', can_view_schedule: true }])
    })
    expect(screen.queryByText('Stale Student')).not.toBeInTheDocument()
    expect(screen.getByText('Current Student')).toBeInTheDocument()
  })

  it('renders semester Gym as separate A/B views and protects same-class meeting switches from stale rosters', async () => {
    const user = userEvent.setup()
    const gymClass = {
      ...otherClass,
      id: 'class-gym',
      course_name_id: 'course-gym',
      course_name: 'Gym',
      teacher_last_name: 'Coach',
      course_term_policy: 'flexible_attendance' as const,
      default_academic_term: 'semester_1' as const,
      meeting_slots: [{ day_type: 'A' as const, period_number: 2 }, { day_type: 'B' as const, period_number: 2 }],
    }
    mocks.useSchedule.mockReturnValue({
      loading: false,
      enrollments: [{
        id: 'enrollment-gym',
        active: true,
        academic_term: 'semester_1',
        meeting_slots: gymClass.meeting_slots,
        class: gymClass,
      }],
    })
    mocks.useClassSearch.mockReturnValue({ loading: false, error: null, results: [{ ...gymClass, score: 100 }] })
    let resolveA!: (members: Array<Record<string, unknown>>) => void
    let resolveB!: (members: Array<Record<string, unknown>>) => void
    mocks.getClassMembers.mockImplementation((_classId: string, meeting: { day_type: 'A' | 'B' }) => new Promise((resolve) => {
      if (meeting.day_type === 'A') resolveA = resolve
      else resolveB = resolve
    }))

    render(<MemoryRouter initialEntries={['/classes/class-gym?day=A&period=2']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    const ownSection = screen.getByRole('heading', { name: 'Your classes' }).closest('section') as HTMLElement
    expect(within(ownSection).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/classes/class-gym?day=A&period=2',
      '/classes/class-gym?day=B&period=2',
    ])
    expect(mocks.getClassMembers).toHaveBeenCalledWith('class-gym', { day_type: 'A', period_number: 2 })
    expect(screen.getByRole('navigation', { name: 'Class meeting' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'A day' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('link', { name: 'B day' }))
    expect(mocks.getClassMembers).toHaveBeenLastCalledWith('class-gym', { day_type: 'B', period_number: 2 })

    await act(async () => {
      resolveB([{ student_id: 'student-b', full_name: 'B Meeting Student', grade: 11, privacy_setting: 'school', can_view_schedule: true }])
    })
    expect(await screen.findByText('B Meeting Student')).toBeInTheDocument()

    await act(async () => {
      resolveA([{ student_id: 'student-a', full_name: 'Stale A Student', grade: 11, privacy_setting: 'school', can_view_schedule: true }])
    })
    expect(screen.queryByText('Stale A Student')).not.toBeInTheDocument()
    expect(screen.getByText('B Meeting Student')).toBeInTheDocument()
  })

  it('excludes only an owned Gym meeting from Other Classes', async () => {
    const user = userEvent.setup()
    const gymClass = {
      ...otherClass,
      id: 'class-gym-a-only',
      course_name_id: 'course-gym',
      course_name: 'Gym',
      teacher_last_name: 'Coach',
      course_term_policy: 'flexible_attendance' as const,
      meeting_slots: [{ day_type: 'A' as const, period_number: 2 }],
    }
    mocks.useSchedule.mockReturnValue({
      loading: false,
      enrollments: [{ id: 'enrollment-gym-a', active: true, academic_term: 'full_year', meeting_slots: gymClass.meeting_slots, class: gymClass }],
    })
    mocks.useClassSearch.mockReturnValue({ loading: false, error: null, results: [{ ...gymClass, score: 100 }] })

    render(<MemoryRouter initialEntries={['/classes/class-gym-a-only?day=A&period=2']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    const ownSection = screen.getByRole('heading', { name: 'Your classes' }).closest('section') as HTMLElement
    expect(within(ownSection).getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Class meeting' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Gym\s*1 period/ }))
    const otherSection = screen.getByRole('heading', { name: 'Other classes' }).closest('section') as HTMLElement
    expect(within(otherSection).getByRole('link')).toHaveAttribute('href', '/classes/class-gym-a-only?day=B&period=2')
  })

  it('marks an owned class, links to the schedule editor, and reports the selected class', async () => {
    mocks.getClassMembers.mockResolvedValue([
      { student_id: 'student-open', full_name: 'Open Student', grade: 10, privacy_setting: 'school', can_view_schedule: true },
      { student_id: 'student-hidden', full_name: 'Hidden Student', grade: 12, privacy_setting: 'classmates', can_view_schedule: false },
    ])
    render(<MemoryRouter initialEntries={['/classes/class-own']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'My Biology', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('On your schedule')).toBeInTheDocument()
    expect(screen.getByText('A day, period 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage this class on your schedule' })).toHaveAttribute('href', '/schedule')
    const reportLinks = screen.getAllByRole('link', { name: 'Report this class' })
    expect(reportLinks.length).toBeGreaterThan(0)
    reportLinks.forEach((link) => expect(link).toHaveAttribute('href', '/report'))
    expect(mocks.getClassMembers).toHaveBeenCalledWith('class-own', undefined)

    const openRow = (await screen.findByText('Open Student')).closest('a') as HTMLElement
    expect(openRow).toHaveAttribute('href', '/students/student-open')
    expect(within(openRow).getByText('View schedule')).toBeInTheDocument()
    const hiddenRow = screen.getByText('Hidden Student').closest('li') as HTMLElement
    expect(within(hiddenRow).queryByRole('link')).not.toBeInTheDocument()
    expect(within(hiddenRow).getByText('Schedule hidden')).toBeInTheDocument()
  })

  it('does not mark a class you are not in as yours', async () => {
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Other Chemistry', level: 2 })).toBeInTheDocument()
    expect(screen.queryByText('On your schedule')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage this class on your schedule' })).not.toBeInTheDocument()
    expect(await screen.findByText('No other students are listed for this class yet.')).toBeInTheDocument()
  })

  it('shows a roster error next to the roster and retries it', async () => {
    const user = userEvent.setup()
    mocks.getClassMembers.mockRejectedValueOnce(new Error('Roster service is down.'))
    render(<MemoryRouter initialEntries={['/classes/class-own']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Roster service is down.')
    mocks.getClassMembers.mockResolvedValueOnce([{ student_id: 'student-back', full_name: 'Back Student', grade: 9, privacy_setting: 'school', can_view_schedule: true }])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Back Student')).toBeInTheDocument()
    expect(mocks.getClassMembers).toHaveBeenCalledTimes(2)
  })

  it('keeps the roster locked until the student adds a schedule', () => {
    mocks.useSchedule.mockReturnValue({ loading: false, enrollments: [] })
    render(<MemoryRouter initialEntries={['/classes/class-other']}><Routes><Route path="/classes/:classId" element={<ClassesPage />} /></Routes></MemoryRouter>)
    expect(screen.getByText('Upload your schedule to see which classmates share your courses.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Upload schedule' }).every((link) => link.getAttribute('href') === '/schedule?import=1')).toBe(true)
    expect(mocks.getClassMembers).not.toHaveBeenCalled()
  })
})

describe('ClassesPage narrow-screen navigation', () => {
  function renderClassRoutes(path: string) {
    return render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/classes" element={<ClassesPage />} />
      <Route path="/classes/:classId" element={<ClassesPage />} />
    </Routes></MemoryRouter>)
  }

  // jsdom has no layout: stand in for the container query that hides the
  // list while a class is open below 680px.
  function hideListWhileAClassIsOpen() {
    const realGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = realGetComputedStyle(element, pseudo)
      if (element instanceof HTMLElement && element.classList.contains('classes-master') && element.closest('.has-selection')) {
        return { ...style, display: 'none' } as CSSStyleDeclaration
      }
      return style
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'scrollY')
  })

  it('returns to the same spot and the same row after going back to the list', async () => {
    const user = userEvent.setup()
    hideListWhileAClassIsOpen()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 })
    renderClassRoutes('/classes')

    await user.click(screen.getByRole('link', { name: /My Biology/ }))
    expect(screen.getByRole('heading', { name: 'My Biology', level: 2 })).toHaveFocus()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 })

    await user.click(screen.getByRole('link', { name: 'All classes' }))
    expect(screen.queryByRole('heading', { name: 'My Biology', level: 2 })).not.toBeInTheDocument()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 400 })
    expect(screen.getByRole('link', { name: /My Biology/ })).toHaveFocus()
  })

  it('puts focus on the class row when a directly opened class is closed', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    renderClassRoutes('/classes/class-own')

    await user.click(screen.getByRole('link', { name: 'All classes' }))
    expect(screen.queryByRole('heading', { name: 'My Biology', level: 2 })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /My Biology/ })).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})
