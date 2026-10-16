import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasswordResetPage } from './PasswordResetPage'

const mocks = vi.hoisted(() => ({ updateRecoveredPassword: vi.fn(async () => undefined) }))

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ updateRecoveredPassword: mocks.updateRecoveredPassword }) }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('PasswordResetPage', () => {
  it('points out a mismatch only after the confirmation is fully typed', async () => {
    const user = userEvent.setup()
    render(<PasswordResetPage />)
    const submit = screen.getByRole('button', { name: 'Save new password' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('New password'), 'correct horse')
    await user.type(screen.getByLabelText('Confirm new password'), 'correct')
    expect(screen.queryByText('The passwords do not match.')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Confirm new password'), ' horsf')
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true')
    expect(submit).toBeDisabled()
    expect(mocks.updateRecoveredPassword).not.toHaveBeenCalled()
  })

  it('saves a matching password and shows failures inline', async () => {
    const user = userEvent.setup()
    mocks.updateRecoveredPassword.mockRejectedValueOnce(new Error('This reset link has expired.'))
    render(<PasswordResetPage />)
    await user.type(screen.getByLabelText('New password'), 'correct horse')
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))

    await waitFor(() => expect(mocks.updateRecoveredPassword).toHaveBeenCalledWith('correct horse'))
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link has expired.')
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeEnabled()
  })
})
