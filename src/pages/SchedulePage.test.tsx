import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SchedulePage } from './SchedulePage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSchedule: vi.fn(),
}))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('../hooks/useSchedule', () => ({ useSchedule: mocks.useSchedule }))
vi.mock('../lib/supabase/data', () => ({ removeEnrollment: vi.fn(), updateEnrollmentTerm: vi.fn() }))
vi.mock('../components/schedule/ScheduleGrid', () => ({ ScheduleGrid: () => <div data-testid="schedule-grid" /> }))
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
  mocks.useAuth.mockReturnValue({ user: { id: 'student-1' }, isAdmin: false, isDemo: false })
  mocks.useSchedule.mockReturnValue(emptySchedule())
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
  })

  it('opens the import flow without auto-onboarding from the no-schedule upload URL', async () => {
    renderPage('/schedule?import=1')
    expect(await screen.findByText('Manual import')).toBeInTheDocument()
    expect(screen.getByTestId('import-dialog')).toHaveAttribute('data-onboarding', 'false')
  })
})
