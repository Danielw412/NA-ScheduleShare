import { supabase } from './supabase/client'

export const PROFILE_PICTURE_BUCKET = 'profile-pictures'
export const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024
const PROFILE_PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export function profilePicturePath(userId: string): string {
  return `${userId}/avatar`
}

export function profilePictureUrl(userId: string, revision?: string | number): string | null {
  if (!supabase || !userId) return null
  const { data } = supabase.storage.from(PROFILE_PICTURE_BUCKET).getPublicUrl(profilePicturePath(userId))
  if (!data.publicUrl) return null
  return revision === undefined ? data.publicUrl : `${data.publicUrl}?v=${encodeURIComponent(String(revision))}`
}

export function validateProfilePicture(file: File): string | null {
  if (!PROFILE_PICTURE_TYPES.has(file.type)) return 'Use a PNG, JPEG, or WebP image.'
  if (file.size === 0) return 'The selected image is empty.'
  if (file.size > MAX_PROFILE_PICTURE_BYTES) return 'Profile pictures must be 2 MB or smaller.'
  return null
}

export async function uploadProfilePicture(userId: string, file: File): Promise<void> {
  const validationError = validateProfilePicture(file)
  if (validationError) throw new Error(validationError)
  const { error } = await requireSupabase().storage
    .from(PROFILE_PICTURE_BUCKET)
    .upload(profilePicturePath(userId), file, {
      upsert: true,
      contentType: file.type,
      cacheControl: '60',
    })
  if (error) throw new Error(error.message || 'The profile picture could not be uploaded.')
}

export async function removeProfilePicture(userId: string): Promise<void> {
  const { error } = await requireSupabase().storage.from(PROFILE_PICTURE_BUCKET).remove([profilePicturePath(userId)])
  if (error) throw new Error(error.message || 'The profile picture could not be removed.')
}

export async function deleteOwnAccount(confirmation: string): Promise<void> {
  const client = requireSupabase()
  const { error } = await client.functions.invoke('delete-account', { body: { confirmation } })
  if (error) {
    const context = (error as unknown as { context?: unknown }).context
    const response = context instanceof Response ? context : null
    const body = response ? await response.clone().json().catch(() => ({})) as { message?: string } : {}
    throw new Error(body.message || 'Your account could not be deleted. No further changes were made.')
  }
  await client.auth.signOut({ scope: 'local' })
}
