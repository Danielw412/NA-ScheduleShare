export interface SiteResetDependencies {
  verifyUser: (token: string) => Promise<{ id: string }>
  verifyAccess: (token: string) => Promise<boolean>
  listProfilePicturePaths: () => Promise<string[]>
  deleteProfilePictures: (paths: string[]) => Promise<void>
  resetDatabase: (actorId: string, confirmation: string) => Promise<Record<string, unknown>>
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const CONFIRMATION = 'RESET SCHEDULESHARE DELETE ALL ACCOUNTS AND CLASSES'
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
    throw new HttpError(401, 'authentication_required', 'Sign in again before using protected tools.')
  }
  const token = authorization.slice(7).trim()
  if (!token) throw new HttpError(401, 'authentication_required', 'Sign in again before using protected tools.')
  return token
}

async function readConfirmation(request: Request): Promise<string> {
  try {
    const body = await request.json() as Record<string, unknown>
    return String(body.confirmation ?? '')
  } catch {
    return ''
  }
}

export async function handleSiteResetRequest(request: Request, dependencies: SiteResetDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Use POST for a site reset.' })

  try {
    const token = bearerToken(request)
    const confirmation = await readConfirmation(request)
    if (confirmation !== CONFIRMATION) {
      throw new HttpError(400, 'confirmation_required', `Type ${CONFIRMATION} exactly to continue.`)
    }
    const user = await dependencies.verifyUser(token)
    if (!await dependencies.verifyAccess(token)) {
      throw new HttpError(403, 'protected_access_required', 'This account cannot reset the website.')
    }
    const paths = await dependencies.listProfilePicturePaths()
    if (paths.length > 0) await dependencies.deleteProfilePictures(paths)
    const deleted = await dependencies.resetDatabase(user.id, confirmation)
    return json(200, { reset: true, deleted, removed_profile_pictures: paths.length })
  } catch (caught) {
    if (caught instanceof HttpError) return json(caught.status, { error: caught.code, message: caught.message })
    return json(500, { error: 'site_reset_failed', message: 'The website reset did not complete. Contact the site owner before trying again.' })
  }
}
