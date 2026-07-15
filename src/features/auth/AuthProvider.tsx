import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { demoProfile } from '../../lib/demo-data'
import type { AccountState, Grade, PrivacySetting, Profile } from '../../lib/domain'
import { demoModeEnabled, isSupabaseConfigured, supabase } from '../../lib/supabase/client'

interface CurrentUser {
  id: string
  email: string | null
}

interface OnboardingInput {
  fullName: string
  grade: Grade
  privacySetting: PrivacySetting
}

interface AuthContextValue {
  user: CurrentUser | null
  profile: Profile | null
  accountState: AccountState | null
  loading: boolean
  isAdmin: boolean
  isDemo: boolean
  configurationMissing: boolean
  signInWithGoogle: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  completeOnboarding: (input: OnboardingInput) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const activeAccount: AccountState = { suspended: false, suspension_reason: null, deleted: false }

function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    full_name: row.full_name as string,
    grade: row.grade as Grade | null,
    privacy_setting: row.privacy_setting as PrivacySetting,
    onboarding_completed: row.onboarding_completed as boolean,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
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
    const { data: accountData, error: accountError } = await supabase.rpc('get_my_account_state', {})
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
      supabase.from('profiles').select('id, full_name, grade, privacy_setting, onboarding_completed, created_at, updated_at').eq('id', nextUser.id).single(),
      supabase.rpc('is_current_user_admin', {}),
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
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
      if (!active) return
      void hydrateUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [hydrateUser, isDemo])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const redirectTo = `${window.location.origin}${window.location.pathname}`
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
    if (error) throw error
  }, [])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (isDemo) return
    if (!supabase) return
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
    if (error) throw error
    await hydrateUser(user)
  }, [hydrateUser, isDemo, user])

  const refreshProfile = useCallback(async () => {
    await hydrateUser(user)
  }, [hydrateUser, user])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    accountState,
    loading,
    isAdmin,
    isDemo,
    configurationMissing: !isSupabaseConfigured && !isDemo,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    completeOnboarding,
    refreshProfile,
  }), [accountState, completeOnboarding, isAdmin, isDemo, loading, profile, refreshProfile, signInWithGoogle, signInWithPassword, signOut, signUpWithPassword, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
