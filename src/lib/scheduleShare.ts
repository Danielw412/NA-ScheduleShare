import { supabase } from './supabase/client'

export const scheduleShareTitle = 'My A/B-Day Schedule | NA ScheduleShare'
export const scheduleShareDescription = 'View my A/B-day class schedule on NA ScheduleShare.'

const shareServiceBaseUrl = import.meta.env.VITE_SCHEDULE_SHARE_BASE_URL?.trim().replace(/\/$/, '')
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function createScheduleShareUrl(): Promise<string> {
  if (!supabase) throw new Error('Sign in before sharing a schedule.')
  if (!shareServiceBaseUrl) throw new Error('Schedule sharing is not configured yet.')

  const { data, error } = await supabase.rpc('get_or_create_schedule_share')
  if (error) throw error

  const token = typeof data === 'string' ? data : ''
  if (!tokenPattern.test(token)) throw new Error('Schedule sharing returned an invalid link.')
  return `${shareServiceBaseUrl}/share/${encodeURIComponent(token)}`
}
