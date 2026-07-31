import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void

const mocks = vi.hoisted(() => ({
  authCallback: undefined as AuthCallback | undefined,
  getUser: vi.fn(),
  loadProfile: vi.fn(),
  markUserActive: vi.fn(async () => undefined),
  onAuthStateChange: vi.fn(),
  recordAuthenticatedEvent: vi.fn(async () => undefined),
  recordAuthAttempt: vi.fn(async () => undefined),
  rpc: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../lib/supabase/client', () => ({
  demoModeEnabled: false,
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          single: () => mocks.loadProfile(userId),
        }),
      }),
    }),
    rpc: mocks.rpc,
  },
}))

vi.mock('../../lib/supabase/data', () => ({
  markUserActive: mocks.markUserActive,
  recordAuthenticatedEvent: mocks.recordAuthenticatedEvent,
  recordAuthAttempt: mocks.recordAuthAttempt,
}))

function profileRow(id: string) {
  return {
    id,
    full_name: `Student ${id}`,
    grade: 11,
    privacy_setting: 'classmates',
    onboarding_completed: true,
    students_visited_at: null,
    created_at: '2026-07-30T00:00:00Z',
    updated_at: '2026-07-30T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function AuthState() {
  const { loading, profile, user } = useAuth()
  return (
    <>
      <output data-testid="loading">{loading ? 'loading' : 'ready'}</output>
      <output data-testid="user">{user?.id ?? 'none'}</output>
      <output data-testid="profile">{profile?.id ?? 'none'}</output>
    </>
  )
}

function renderProvider() {
  return render(<AuthProvider><AuthState /></AuthProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authCallback = undefined
  mocks.onAuthStateChange.mockImplementation((callback: AuthCallback) => {
    mocks.authCallback = callback
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
  })
  mocks.rpc.mockImplementation((functionName: string) => {
    if (functionName === 'get_my_account_state') {
      return Promise.resolve({ data: [{ suspended: false, suspension_reason: null, deleted: false }], error: null })
    }
    return Promise.resolve({ data: false, error: null })
  })
  mocks.loadProfile.mockImplementation(async (userId: string) => ({ data: profileRow(userId), error: null }))
})

afterEach(() => cleanup())

describe('AuthProvider hydration', () => {
  it('treats a missing session as a normal signed-out state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const missingSession = new Error('Auth session missing!')
    missingSession.name = 'AuthSessionMissingError'
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: missingSession })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('finishes loading when the initial Auth verification fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('auth unavailable') })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(mocks.loadProfile).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('finishes loading when the profile request fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@example.com' } }, error: null })
    mocks.loadProfile.mockResolvedValue({ data: null, error: new Error('profile unavailable') })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
    expect(screen.getByTestId('user')).toHaveTextContent('user-a')
    expect(screen.getByTestId('profile')).toHaveTextContent('none')
    consoleError.mockRestore()
  })

  it('does not restore private profile state after sign-out during hydration', async () => {
    const profileRequest = deferred<{ data: ReturnType<typeof profileRow>; error: null }>()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@example.com' } }, error: null })
    mocks.loadProfile.mockReturnValue(profileRequest.promise)

    renderProvider()
    await waitFor(() => expect(mocks.loadProfile).toHaveBeenCalledWith('user-a'))

    act(() => mocks.authCallback?.('SIGNED_OUT', null))
    expect(screen.getByTestId('loading')).toHaveTextContent('ready')
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('profile')).toHaveTextContent('none')

    await act(async () => {
      profileRequest.resolve({ data: profileRow('user-a'), error: null })
      await profileRequest.promise
    })

    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('profile')).toHaveTextContent('none')
  })

  it('lets a newer auth event supersede a delayed initial-session lookup', async () => {
    const initialUser = deferred<{ data: { user: { id: string; email: string } }; error: null }>()
    mocks.getUser.mockReturnValue(initialUser.promise)
    renderProvider()
    await waitFor(() => expect(mocks.authCallback).toBeTypeOf('function'))

    act(() => mocks.authCallback?.('SIGNED_IN', {
      user: { id: 'user-b', email: 'b@example.com' },
    } as Session))
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('user-b'))

    await act(async () => {
      initialUser.resolve({ data: { user: { id: 'user-a', email: 'a@example.com' } }, error: null })
      await initialUser.promise
    })

    expect(screen.getByTestId('user')).toHaveTextContent('user-b')
    expect(screen.getByTestId('profile')).toHaveTextContent('user-b')
  })
})
