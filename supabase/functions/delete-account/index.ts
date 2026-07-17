import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'
import { handleDeleteAccountRequest, type DeleteAccountDependencies } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  || Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? ''

function dependencies(): DeleteAccountDependencies {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase function environment is unavailable.')
  }
  const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    verifyUser: async (token) => {
      const { data, error } = await authClient.auth.getUser(token)
      if (error || !data.user) throw error ?? new Error('Authenticated user missing.')
      return { id: data.user.id }
    },
    deleteAvatar: async (userId) => {
      const { error } = await adminClient.storage.from('profile-pictures').remove([`${userId}/avatar`])
      if (error) throw error
    },
    deleteUser: async (userId) => {
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) throw error
    },
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    try {
      return handleDeleteAccountRequest(request, dependencies())
    } catch {
      return Promise.resolve(Response.json(
        { error: 'account_deletion_unavailable', message: 'Account deletion is temporarily unavailable.' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
      ))
    }
  },
}
