import { supabase } from './client'

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

async function callUntypedRpc(functionName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const client = requireClient()
  const rpc = client.rpc.bind(client) as unknown as (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>
  const { data, error } = await rpc(functionName, args)
  if (error) throw error
  return data
}

export async function getGuestExplorationEnabled(): Promise<boolean> {
  const value = await callUntypedRpc('get_guest_exploration_enabled')
  return value === null || value === undefined ? true : Boolean(value)
}

export async function adminUpdateGuestExplorationEnabled(enabled: boolean): Promise<void> {
  await callUntypedRpc('admin_update_guest_exploration_enabled', {
    p_enabled: enabled,
  })
}
