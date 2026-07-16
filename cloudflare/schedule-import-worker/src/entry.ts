import { handleRequest, type Env } from './index'

const PRODUCTION_ORIGIN = 'https://danielw412.github.io'
const LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

interface JwtClaims {
  iss?: unknown
  exp?: unknown
}

function normalizedEnv(env: Env): Env {
  return {
    ...env,
    SUPABASE_URL: env.SUPABASE_URL?.trim().replace(/\/$/, ''),
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY?.trim(),
  }
}

function isAllowedOrigin(origin: string): boolean {
  return origin === PRODUCTION_ORIGIN || LOCAL_ORIGINS.has(origin)
}

function jsonResponse(origin: string, status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    },
  })
}

function decodeJwtClaims(token: string): JwtClaims | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const value: unknown = JSON.parse(atob(padded))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as JwtClaims
      : null
  } catch {
    return null
  }
}

async function preflightAuthentication(request: Request, env: Env, origin: string): Promise<Response | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return null

  const claims = decodeJwtClaims(token)
  const expectedIssuer = `${env.SUPABASE_URL}/auth/v1`
  if (claims && typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)) {
    return jsonResponse(origin, 401, {
      error: 'session_expired',
      message: 'Your Supabase access token has expired. Sign out and sign back in.',
    })
  }
  if (claims && typeof claims.iss === 'string' && claims.iss.replace(/\/$/, '') !== expectedIssuer) {
    return jsonResponse(origin, 401, {
      error: 'session_project_mismatch',
      message: 'The website and schedule import Worker are connected to different Supabase projects.',
    })
  }

  let response: Response
  try {
    response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  } catch {
    return jsonResponse(origin, 503, {
      error: 'authentication_unavailable',
      message: 'The Worker could not reach Supabase to verify your session.',
    })
  }

  if (response.ok) return null

  const upstreamText = await response.text().catch(() => '')
  if (/invalid api key|apikey/i.test(upstreamText)) {
    return jsonResponse(origin, 503, {
      error: 'worker_publishable_key_rejected',
      message: 'Supabase rejected the Worker publishable key. Update the production Worker secret and redeploy it.',
    })
  }

  return jsonResponse(origin, 401, {
    error: 'session_rejected',
    message: 'Supabase rejected the current login session. Sign out, sign back in, and try again.',
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cleanEnv = normalizedEnv(env)
    const origin = request.headers.get('Origin') ?? ''
    const url = new URL(request.url)

    if (
      request.method !== 'POST'
      || url.pathname !== '/api/schedule-import'
      || !isAllowedOrigin(origin)
    ) {
      return handleRequest(request, cleanEnv)
    }

    const authError = await preflightAuthentication(request, cleanEnv, origin)
    if (authError) return authError
    return handleRequest(request, cleanEnv)
  },
}
