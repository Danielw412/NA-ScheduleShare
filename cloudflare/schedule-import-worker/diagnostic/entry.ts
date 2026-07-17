import {
  MOONDREAM_MODEL,
  buildPrompt,
  describeMoondreamImageBoundary,
  fileToMoondreamImage,
  invokeMoondreamQuery,
  moondreamAnswer,
  type AiBinding,
} from '../src/index'

const MAX_FIXTURE_BYTES = 128 * 1024
const MAX_DIAGNOSTIC_CATALOG_SIZE = 304

function diagnosticCatalog(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Diagnostic Course ${String(index).padStart(3, '0')}`,
  }))
}

interface DiagnosticEnv {
  AI: AiBinding
}

function classifyError(message: string): 'configuration' | 'transport' | 'model' | 'quota' {
  const normalized = message.toLowerCase()
  if (normalized.includes('429') || normalized.includes('quota') || normalized.includes('rate limit')) return 'quota'
  if (normalized.includes('5006') || normalized.includes('type mismatch') || normalized.includes('/image')) return 'transport'
  if (normalized.includes('binding') || normalized.includes('authentication') || normalized.includes('unauthorized')) return 'configuration'
  return 'model'
}

export default {
  async fetch(request: Request, env: DiagnosticEnv): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ ok: false, category: 'configuration', message: 'Use POST with the PNG fixture body.' }, { status: 405 })
    }
    if (!env.AI) {
      return Response.json({ ok: false, category: 'configuration', message: 'The Workers AI binding is unavailable.' }, { status: 503 })
    }

    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FIXTURE_BYTES) {
      return Response.json({ ok: false, category: 'configuration', message: 'The diagnostic fixture must be 1-131072 bytes.' }, { status: 400 })
    }

    const file = new File([bytes], 'moondream-diagnostic.png', { type: 'image/png' })
    const image = await fileToMoondreamImage(file)
    const boundary = describeMoondreamImageBoundary(image)
    const requestedCatalogSize = Number(request.headers.get('X-Diagnostic-Catalog-Size') ?? '0')
    if (!Number.isInteger(requestedCatalogSize) || requestedCatalogSize < 0 || requestedCatalogSize > MAX_DIAGNOSTIC_CATALOG_SIZE) {
      return Response.json({
        ok: false,
        category: 'configuration',
        message: `X-Diagnostic-Catalog-Size must be an integer from 0 through ${MAX_DIAGNOSTIC_CATALOG_SIZE}.`,
      }, { status: 400 })
    }
    const question = buildPrompt(diagnosticCatalog(requestedCatalogSize))

    try {
      const output = await invokeMoondreamQuery(
        env.AI,
        image,
        question,
        8_000,
      )
      const answer = moondreamAnswer(output)
      if (answer === null) {
        return Response.json({
          ok: false,
          category: 'model',
          transport: 'workers-ai-binding',
          model: MOONDREAM_MODEL,
          task: 'query',
          boundary,
          catalogue_size: requestedCatalogSize,
          question_length: question.length,
          message: 'Cloudflare returned an unexpected model result shape.',
        }, { status: 502 })
      }
      return Response.json({
        ok: true,
        category: 'success',
        transport: 'workers-ai-binding',
        model: MOONDREAM_MODEL,
        task: 'query',
        boundary,
        catalogue_size: requestedCatalogSize,
        question_length: question.length,
        answer_received: answer.length > 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({
        ok: false,
        category: classifyError(message),
        transport: 'workers-ai-binding',
        model: MOONDREAM_MODEL,
        task: 'query',
        boundary,
        catalogue_size: requestedCatalogSize,
        question_length: question.length,
        error_name: error instanceof Error ? error.name : 'UnknownError',
        error_message: message,
      }, { status: 502 })
    }
  },
}
