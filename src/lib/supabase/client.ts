import { createClient } from '@supabase/supabase-js'
import { instrumentFetch } from '../observability/instrumentFetch'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(url && publishableKey)
export const supabaseUrl = url?.replace(/\/$/, '') ?? ''
export const supabasePublishableKey = publishableKey ?? ''
export const demoModeEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_MODE === 'true'

export const supabase = isSupabaseConfigured
  ? createClient<Database>(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      // Request breadcrumbs and 5xx reporting; see docs/observability.md.
      global: { fetch: instrumentFetch((input, init) => fetch(input, init)) },
    })
  : null
