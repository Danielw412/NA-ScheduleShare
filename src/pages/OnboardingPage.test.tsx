import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingPage } from './OnboardingPage'

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(async () => undefined),
  profile: { full_name: 'New Student', grade: null as number | null, onboarding_completed: false },
}))

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'student-1' }, profile: mocks.profile, completeOnboarding: mocks.completeOnboarding }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/students" element={<p>Students page</p>} />
        <Route path="/schedule" element={<p>Schedule page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mocks.profile = { full_name: 'New Student', grade: null, onboarding_completed: false }
})
afterEach(() => cleanup())

describe('OnboardingPage', () => {
  it('needs a grade, then saves name, grade, and privacy and continues to the saved destination', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('scheduleshare:auth-destination', '/students')
    renderPage()

    expect(screen.getByRole('main', { name: 'Set up your profile' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('')
    expect(screen.getByRole('radio', { name: /Classmates/ })).toBeChecked()
    const submit = screen.getByRole('button', { name: 'Save and continue' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('Choose your grade to continue.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Full name'), 'Riley Chen')
    await user.click(screen.getByRole('radio', { name: '11' }))
    await user.click(screen.getByRole('radio', { name: /Private/ }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(mocks.completeOnboarding).toHaveBeenCalledWith({ fullName: 'Riley Chen', grade: 11, privacySetting: 'private' }))
    expect(await screen.findByText('Students page')).toBeInTheDocument()
    expect(sessionStorage.getItem('scheduleshare:auth-destination')).toBeNull()
  })

  it('keeps a failed save on the form', async () => {
    const user = userEvent.setup()
    mocks.completeOnboarding.mockRejectedValueOnce(new Error('That name is already in review.'))
    mocks.profile = { full_name: 'Riley Chen', grade: 10, onboarding_completed: false }
    renderPage()

    expect(screen.getByRole('radio', { name: '10' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already in review.')
  })

  it('skips onboarding once it is complete', () => {
    mocks.profile = { full_name: 'Riley Chen', grade: 10, onboarding_completed: true }
    renderPage()
    expect(screen.getByText('Schedule page')).toBeInTheDocument()
  })
})
