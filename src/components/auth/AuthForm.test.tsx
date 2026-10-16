import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthForm } from './AuthForm'

const mocks = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(async () => undefined),
  signUpWithPassword: vi.fn(async () => undefined),
  requestPasswordReset: vi.fn(async () => undefined),
  rememberAuthDestination: vi.fn(),
  configurationMissing: false,
}))

vi.mock('../../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    configurationMissing: mocks.configurationMissing,
    signInWithGoogle: mocks.signInWithGoogle,
    signInWithPassword: mocks.signInWithPassword,
    signUpWithPassword: mocks.signUpWithPassword,
    requestPasswordReset: mocks.requestPasswordReset,
  }),
}))
vi.mock('../../lib/authDestination', () => ({ rememberAuthDestination: mocks.rememberAuthDestination }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configurationMissing = false
})
afterEach(() => cleanup())

describe('AuthForm', () => {
  it('signs in with email and remembers where to go next', async () => {
    const user = userEvent.setup()
    render(<AuthForm next="/students" />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'student@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith('student@example.com', 'correct horse'))
    expect(mocks.rememberAuthDestination).toHaveBeenCalledWith('/students')
  })

  it('shows sign-in failures inline', async () => {
    const user = userEvent.setup()
    mocks.signInWithPassword.mockRejectedValueOnce(new Error('Invalid login credentials'))
    render(<AuthForm />)
    await user.type(screen.getByLabelText('Email'), 'student@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('tabs from Email straight to Password, then to Forgot password', async () => {
    const user = userEvent.setup()
    render(<AuthForm />)
    screen.getByLabelText('Email').focus()

    await user.tab()
    expect(screen.getByLabelText('Password')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus()
  })

  it('asks for an email, not a password, when resetting a password', async () => {
    const user = userEvent.setup()
    render(<AuthForm />)
    await user.type(screen.getByLabelText('Email'), 'student@example.com')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))

    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('student@example.com')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith('student@example.com'))
    expect(await screen.findByRole('status')).toHaveTextContent('reset link is on its way')

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('creates an account and explains the confirmation email', async () => {
    const user = userEvent.setup()
    render(<AuthForm initialMode="sign-up" />)
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('minlength', '8')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Use at least 8 characters.')

    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'long enough')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(mocks.signUpWithPassword).toHaveBeenCalledWith('new@example.com', 'long enough'))
    expect(await screen.findByRole('status')).toHaveTextContent('Confirm my account')
  })

  it('continues with Google and remembers the destination first', async () => {
    const user = userEvent.setup()
    render(<AuthForm next="/schedule-engine" />)
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(mocks.rememberAuthDestination).toHaveBeenCalledWith('/schedule-engine')
    expect(mocks.signInWithGoogle).toHaveBeenCalledOnce()
  })

  it('disables sign-in when Supabase is not configured', () => {
    mocks.configurationMissing = true
    render(<AuthForm />)
    expect(screen.getByRole('alert')).toHaveTextContent('.env.local')
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })
})
