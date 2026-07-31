import { handleRequest, type Env } from './index'
import { handleShareRequest } from './share'

function normalizedEnv(env: Env): Env {
  return {
    ...env,
    SUPABASE_URL: env.SUPABASE_URL?.trim().replace(/\/$/, ''),
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY?.trim(),
  }
}

function routeCategory(pathname: string): 'share_page' | 'share_image' | 'schedule_import' | 'other' {
  if (/^\/share\/[^/]+\/image\.png$/i.test(pathname)) return 'share_image'
  if (/^\/share\/[^/]+$/i.test(pathname)) return 'share_page'
  if (pathname === '/api/schedule-import') return 'schedule_import'
  return 'other'
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cleanEnv = normalizedEnv(env)
    const startedAt = Date.now()
    const route = routeCategory(new URL(request.url).pathname)
    const cfRay = request.headers.get('CF-Ray')
    const requestId = cfRay && /^[a-z0-9-]{1,100}$/i.test(cfRay) ? cfRay : crypto.randomUUID()
    try {
      const shareResponse = await handleShareRequest(request, cleanEnv)
      const response = shareResponse ?? await handleRequest(request, cleanEnv, { requestId })
      console.log(JSON.stringify({
        event: 'worker_request_completed',
        request_id: requestId,
        route,
        method: request.method,
        status: response.status,
        duration_ms: Date.now() - startedAt,
      }))
      return response
    } catch (error) {
      console.error(JSON.stringify({
        event: 'worker_request_failed',
        request_id: requestId,
        route,
        method: request.method,
        error_name: error instanceof Error ? error.name : 'UnknownError',
        duration_ms: Date.now() - startedAt,
      }))
      return Response.json({ error: 'worker_failure', message: 'The request failed unexpectedly.' }, {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  },
}
