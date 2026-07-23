import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { demoProfile } from '../../lib/demo-data'
import type { AccountState, Grade, PrivacySetting, Profile } from '../../lib/domain'
import { authRedirectUrl } from '../../lib/authRedirect'
import { demoModeEnabled, isSupabaseConfigured, supabase } from '../../lib/supabase/client'
import { markUserActive, recordAuthenticatedEvent, recordAuthAttempt } from '../../lib/supabase/data'

interface CurrentUser {
  id: string
  email: string | null
}

interface OnboardingInput {
  fullName: string
  grade: Grade
  privacySetting: PrivacySetting
}

interface ProfileUpdateInput {
  fullName: string
  privacySetting: PrivacySetting
}

interface AuthContextValue {
  user: CurrentUser | null
  profile: Profile | null
  accountState: AccountState | null
  loading: boolean
  passwordRecovery: boolean
  isAdmin: boolean
  isDemo: boolean
  configurationMissing: boolean
  signInWithGoogle: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updateRecoveredPassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
  completeOnboarding: (input: OnboardingInput) => Promise<void>
  updateProfile: (input: ProfileUpdateInput) => Promise<void>
  markStudentsVisited: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const activeAccount: AccountState = { suspended: false, suspension_reason: null, deleted: false }

function onboardingErrorMessage(code: string | undefined): string {
  if (code === '42501') {
    return 'Your profile could not be saved because this account is not allowed to make that change. Please sign in again or contact an administrator.'
  }
  if (code === '23514' || code === '22001' || code === '22P02') {
    return 'Please check that your name, grade, and privacy setting are valid.'
  }
  return 'We could not save your profile right now. Please try again.'
}

function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    full_name: row.full_name as string,
    grade: row.grade as Grade | null,
    privacy_setting: row.privacy_setting as PrivacySetting,
    onboarding_completed: row.onboarding_completed as boolean,
    students_visited_at: (row.students_visited_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

async function recordSignInOutcome(provider: 'google' | 'password'): Promise<void> {
  if (!supabase) return
  const { data } = await supabase.rpc('get_my_account_state')
  const row = Array.isArray(data) ? data[0] : data
  const suspended = Boolean(row && typeof row === 'object' && (row as Record<string, unknown>).suspended)
  await recordAuthenticatedEvent(
    suspended ? 'login_blocked_suspended' : 'login_succeeded',
    suspended ? 'blocked' : 'succeeded',
    { provider },
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const isDemo = !isSupabaseConfigured && demoModeEnabled

  const hydrateUser = useCallback(async (nextUser: CurrentUser | null) => {
    setUser(nextUser)
    setProfile(null)
    setIsAdmin(false)
    setAccountState(null)
    if (!nextUser || !supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const { data: accountData, error: accountError } = await supabase.rpc('get_my_account_state')
    if (accountError) {
      setLoading(false)
      throw accountError
    }
    const accountRow = Array.isArray(accountData) ? accountData[0] : accountData
    const nextAccount: AccountState = accountRow
      ? {
          suspended: Boolean((accountRow as Record<string, unknown>).suspended),
          suspension_reason: ((accountRow as Record<string, unknown>).suspension_reason as string | null) ?? null,
          deleted: Boolean((accountRow as Record<string, unknown>).deleted),
        }
      : activeAccount
    setAccountState(nextAccount)
    if (nextAccount.suspended || nextAccount.deleted) {
      setLoading(false)
      return
    }

    const [profileResult, adminResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, grade, privacy_setting, onboarding_completed, students_visited_at, created_at, updated_at').eq('id', nextUser.id).single(),
      supabase.rpc('is_current_user_admin'),
    ])
    if (profileResult.error) throw profileResult.error
    setProfile(toProfile(profileResult.data as unknown as Record<string, unknown>))
    setIsAdmin(Boolean(adminResult.data))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isDemo) {
      setUser({ id: demoProfile.id, email: 'jordan@example.com' })
      setProfile(demoProfile)
      setAccountState(activeAccount)
      setIsAdmin(true)
      setLoading(false)
      return
    }
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      void hydrateUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_IN' && window.sessionStorage.getItem('scheduleshare:oauth-sign-in') === 'pending') {
        window.sessionStorage.removeItem('scheduleshare:oauth-sign-in')
        void recordSignInOutcome('google').catch(() => undefined)
      }
      void hydrateUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [hydrateUser, isDemo])

  useEffect(() => {
    if (!user || accountState?.suspended || accountState?.deleted || isDemo) return
    void markUserActive().catch(() => undefined)
    const timer = window.setInterval(() => void markUserActive().catch(() => undefined), 10 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [accountState?.deleted, accountState?.suspended, isDemo, user])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const redirectTo = authRedirectUrl()
    window.sessionStorage.setItem('scheduleshare:oauth-sign-in', 'pending')
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
    if (error) {
      window.sessionStorage.removeItem('scheduleshare:oauth-sign-in')
      throw error
    }
  }, [])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const rateLimited = error.status === 429 || error.message.toLowerCase().includes('rate limit')
      void recordAuthAttempt(rateLimited ? 'login_blocked_rate_limit' : 'login_failed', email, 'failed', rateLimited ? 'rate_limit' : 'invalid_credentials').catch(() => undefined)
      throw error
    }
    void recordSignInOutcome('password').catch(() => undefined)
  }, [])

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    })
    if (error) throw error
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
    if (error) {
      void recordAuthAttempt('password_reset_failed', email, 'failed', error.status === 429 ? 'rate_limit' : 'provider_error').catch(() => undefined)
      throw error
    }
    void recordAuthAttempt('password_reset_requested', email, 'requested').catch(() => undefined)
  }, [])

  const updateRecoveredPassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      void recordAuthenticatedEvent('password_reset_failed', 'failed', { error_category: 'password_update_rejected' }).catch(() => undefined)
      throw error
    }
    void recordAuthenticatedEvent('password_reset_completed', 'succeeded').catch(() => undefined)
    setPasswordRecovery(false)
  }, [])

  const signOut = useCallback(async () => {
    if (isDemo) return
    if (!supabase) return
    void recordAuthenticatedEvent('logout_all_devices', 'succeeded').catch(() => undefined)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [isDemo])

  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    if (isDemo) {
      setProfile((current) => current ? { ...current, full_name: input.fullName, grade: input.grade, privacy_setting: input.privacySetting, onboarding_completed: true } : current)
      return
    }
    if (!supabase || !user) throw new Error('You must be signed in.')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: input.fullName, grade: input.grade, privacy_setting: input.privacySetting, onboarding_completed: true })
      .eq('id', user.id)
    if (error) {
      if (import.meta.env.DEV) console.error('Could not complete onboarding.', error)
      throw new Error(onboardingErrorMessage(error.code))
    }
    await hydrateUser(user)
  }, [hydrateUser, isDemo, user])

  const updateProfile = useCallback(async (input: ProfileUpdateInput) => {
    const fullName = input.fullName.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2 || fullName.length > 100) throw new Error('Full name must be between 2 and 100 characters.')
    if (isDemo) {
      setProfile((current) => current ? { ...current, full_name: fullName, privacy_setting: input.privacySetting } : current)
      return
    }
    if (!supabase || !user) throw new Error('You must be signed in.')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, privacy_setting: input.privacySetting })
      .eq('id', user.id)
    if (error) throw new Error(onboardingErrorMessage(error.code))
    await hydrateUser(user)
  }, [hydrateUser, isDemo, user])

  const refreshProfile = useCallback(async () => {
    await hydrateUser(user)
  }, [hydrateUser, user])

  const markStudentsVisited = useCallback(async () => {
    if (profile?.students_visited_at) return
    const visitedAt = new Date().toISOString()
    if (isDemo) {
      setProfile((current) => current ? { ...current, students_visited_at: visitedAt } : current)
      return
    }
    if (!supabase || !user) throw new Error('You must be signed in.')
    const { error } = await supabase
      .from('profiles')
      .update({ students_visited_at: visitedAt })
      .eq('id', user.id)
      .is('students_visited_at', null)
    if (error) throw error
    setProfile((current) => current ? { ...current, students_visited_at: current.students_visited_at ?? visitedAt } : current)
  }, [isDemo, profile?.students_visited_at, user])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    accountState,
    loading,
    passwordRecovery,
    isAdmin,
    isDemo,
    configurationMissing: !isSupabaseConfigured && !isDemo,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updateRecoveredPassword,
    signOut,
    completeOnboarding,
    updateProfile,
    markStudentsVisited,
    refreshProfile,
  }), [accountState, completeOnboarding, isAdmin, isDemo, loading, markStudentsVisited, passwordRecovery, profile, refreshProfile, requestPasswordReset, signInWithGoogle, signInWithPassword, signOut, signUpWithPassword, updateProfile, updateRecoveredPassword, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
