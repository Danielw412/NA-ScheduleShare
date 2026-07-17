export interface DeleteAccountDependencies {
  verifyUser: (token: string) => Promise<{ id: string }>
  deleteAvatar: (userId: string) => Promise<void>
  deleteUser: (userId: string) => Promise<void>
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'authentication_required', 'Sign in again before deleting your account.')
  }
  const token = authorization.slice(7).trim()
  if (!token) throw new HttpError(401, 'authentication_required', 'Sign in again before deleting your account.')
  return token
}

async function confirmation(request: Request): Promise<string> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'invalid_request', 'Type DELETE to confirm permanent account deletion.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  return String((body as Record<string, unknown>).confirmation ?? '')
}

export async function handleDeleteAccountRequest(request: Request, dependencies: DeleteAccountDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Use POST to delete an account.' })

  try {
    const token = bearerToken(request)
    if (await confirmation(request) !== 'DELETE') {
      throw new HttpError(400, 'confirmation_required', 'Type DELETE to confirm permanent account deletion.')
    }
    const user = await dependencies.verifyUser(token)
    await dependencies.deleteAvatar(user.id)
    await dependencies.deleteUser(user.id)
    return json(200, { deleted: true, removed_profile_picture: true })
  } catch (caught) {
    if (caught instanceof HttpError) return json(caught.status, { error: caught.code, message: caught.message })
    return json(500, { error: 'account_deletion_failed', message: 'Your account could not be deleted. Please try again.' })
  }
}
