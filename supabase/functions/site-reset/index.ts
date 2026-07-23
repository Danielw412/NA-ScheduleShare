import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'
import { handleSiteResetRequest, type SiteResetDependencies } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  || Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? ''

function dependencies(): SiteResetDependencies {
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
    verifyAccess: async (token) => {
      const callerClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data, error } = await callerClient.rpc('is_current_user_super_admin')
      if (error) throw error
      return Boolean(data)
    },
    listProfilePicturePaths: async () => {
      const paths: string[] = []
      for (let page = 1; ; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        paths.push(...data.users.map((user) => `${user.id}/avatar`))
        if (data.users.length < 1000) break
      }
      return paths
    },
    deleteProfilePictures: async (paths) => {
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await adminClient.storage.from('profile-pictures').remove(paths.slice(index, index + 100))
        if (error) throw error
      }
    },
    resetDatabase: async (actorId, confirmation) => {
      const { data, error } = await adminClient.rpc('service_reset_site_data', {
        p_actor_id: actorId,
        p_confirmation: confirmation,
      })
      if (error) throw error
      return data as Record<string, unknown>
    },
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    try {
      return handleSiteResetRequest(request, dependencies())
    } catch {
      return Promise.resolve(Response.json(
        { error: 'site_reset_unavailable', message: 'Website reset is temporarily unavailable.' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
      ))
    }
  },
}
