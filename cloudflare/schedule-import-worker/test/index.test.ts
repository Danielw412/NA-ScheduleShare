import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest, parseTeacherLastName, type Env } from '../src/index'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AP_STATS_ID = '11111111-1111-4111-8111-111111111111'
const LUNCH_ID = '22222222-2222-4222-8222-222222222222'
const STUDY_HALL_ID = '33333333-3333-4333-8333-333333333333'
const CLASS_ID = '44444444-4444-4444-8444-444444444444'
const ORIGIN = 'http://localhost:5173'

const catalog = [
  { id: AP_STATS_ID, name: 'AP Statistics' },
  { id: LUNCH_ID, name: 'Lunch' },
  { id: STUDY_HALL_ID, name: 'Study Hall' },
]

interface TestEntry {
  source_course_name: string
  teacher_raw: string
  term: string
  meeting_slots: Array<{ day_type: string; period_number: number }>
  confidence: number
  warnings: string[]
  course_id: string | null
  canonical_course_name: string | null
  course_match_confidence: number
}

const validEntry: TestEntry = {
  source_course_name: 'AP Statistics (CHS)',
  teacher_raw: 'Email Lester, Luke - Rm: S252',
  term: 'full_year',
  meeting_slots: [{ day_type: 'A', period_number: 1 }, { day_type: 'B', period_number: 1 }],
  confidence: 0.98,
  warnings: [] as string[],
  course_id: AP_STATS_ID,
  canonical_course_name: 'AP Statistics',
  course_match_confidence: 0.99,
}

function aiResult(entries = [validEntry], overrides: Record<string, unknown> = {}) {
  return {
    schedule_detected: true,
    period_mapping_visible: true,
    image_quality: 'clear',
    warnings: [],
    entries,
    ...overrides,
  }
}

interface AiRunCall {
  model: string
  input: unknown
}

let mockExistingClasses: unknown[] = []
let mockCatalog: unknown[] = catalog
let mockAuthStatus = 200
let mockSupabaseCalls: Array<{ url: string; headers: Headers }> = []

class MemoryKv {
  values = new Map<string, string>()

  async get(key: string) {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string) {
    this.values.set(key, value)
  }
}

function createEnv(
  answers: unknown[] = [aiResult()],
  existingClasses: unknown[] = [],
  calls: AiRunCall[] = [],
): Env {
  mockExistingClasses = existingClasses
  let answerIndex = 0

  return {
    AI: {
      async run(model, input) {
        calls.push({ model, input })
        const answer = answers[Math.min(answerIndex, answers.length - 1)]
        answerIndex += 1
        if (answer instanceof Error) throw answer
        return {
          result: {
            answer: typeof answer === 'string' ? answer : JSON.stringify(answer),
          },
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }
      },
    },
    RATE_LIMIT: new MemoryKv(),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    RATE_LIMIT_MAX: '6',
    RATE_LIMIT_WINDOW_SECONDS: '3600',
  }
}

function mockSupabase(existingClasses: unknown[] = [], authStatus = 200, catalogRows: unknown[] = catalog) {
  mockExistingClasses = existingClasses
  mockCatalog = catalogRows
  mockAuthStatus = authStatus
  mockSupabaseCalls = []

  vi.stubGlobal('fetch', vi.fn(async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)
    const headers = new Headers(init?.headers)

    if (url.includes('/auth/v1/user')) {
      mockSupabaseCalls.push({ url, headers })
      return Response.json(
        mockAuthStatus === 200
          ? { id: USER_ID }
          : { error: 'invalid' },
        { status: mockAuthStatus },
      )
    }

    if (url.includes('/rest/v1/course_names')) {
      mockSupabaseCalls.push({ url, headers })
      return Response.json(mockCatalog)
    }

    if (url.includes('/rest/v1/classes')) {
      mockSupabaseCalls.push({ url, headers })
      return Response.json(mockExistingClasses)
    }

    return new Response(null, { status: 404 })
  }))
}

function requestWithImages(files: File[], options: { origin?: string; token?: string } = {}) {
  const form = new FormData()
  for (const file of files) form.append('images', file)
  const headers = new Headers({ Origin: options.origin ?? ORIGIN })
  if (options.token !== '') headers.set('Authorization', `Bearer ${options.token ?? 'valid-token'}`)
  return new Request('https://worker.example/api/schedule-import', { method: 'POST', headers, body: form })
}

function image(name = 'schedule.png', type = 'image/png', bytes = 32) {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mockSupabase()
})

describe('authentication and CORS', () => {
  it('rejects requests without a Supabase access token', async () => {
    const response = await handleRequest(requestWithImages([image()], { token: '' }), createEnv())
    expect(response.status).toBe(401)
    expect(await body(response)).toMatchObject({ error: 'authentication_required' })
  })

  it('rejects an expired token after server-side validation', async () => {
    mockSupabase([], 401)
    const response = await handleRequest(requestWithImages([image()]), createEnv())
    expect(response.status).toBe(401)
    expect(await body(response)).toMatchObject({ error: 'session_expired' })
  })

  it('uses the caller token and publishable key for RLS-protected reads', async () => {
    const response = await handleRequest(requestWithImages([image()]), createEnv())
    expect(response.status).toBe(200)
    const protectedReads = mockSupabaseCalls.filter(({ url }) => url.includes('/rest/v1/'))
    expect(protectedReads).toHaveLength(2)
    for (const call of protectedReads) {
      expect(call.headers.get('Authorization')).toBe('Bearer valid-token')
      expect(call.headers.get('apikey')).toBe('sb_publishable_test')
    }
  })

  it('answers preflight only for configured production and local origins', async () => {
    const allowed = await handleRequest(new Request('https://worker.example/api/schedule-import', {
      method: 'OPTIONS', headers: { Origin: ORIGIN },
    }), createEnv())
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const blocked = await handleRequest(new Request('https://worker.example/api/schedule-import', {
      method: 'OPTIONS', headers: { Origin: 'https://attacker.example' },
    }), createEnv())
    expect(blocked.status).toBe(403)
    expect(blocked.headers.get('Access-Control-Allow-Origin')).not.toBe('https://attacker.example')
  })
})

describe('image input and rate limiting', () => {
  it('accepts one image and returns a review row', async () => {
    const response = await handleRequest(requestWithImages([image()]), createEnv())
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({ image_count: 1 })
  })

  it('passes the exact uploaded bytes in the schema-required Moondream data URI', async () => {
    const uploadedBytes = [0, 1, 2, 127, 128, 254, 255]
    const calls: AiRunCall[] = []
    const uploadedImage = new File([Uint8Array.from(uploadedBytes)], 'schedule.png', { type: 'image/png' })
    const response = await handleRequest(
      requestWithImages([uploadedImage]),
      createEnv([aiResult()], [], calls),
    )

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('@cf/moondream/moondream3.1-9B-A2B')
    expect(calls[0].input).toMatchObject({
      task: 'query',
      question: expect.any(String),
      reasoning: false,
      temperature: 0,
      max_tokens: 8_000,
      stream: false,
    })
    const input = calls[0].input as { image: unknown }
    expect(typeof input.image).toBe('string')
    expect(Array.isArray(input.image)).toBe(false)
    const [prefix, encoded] = (input.image as string).split(',', 2)
    expect(prefix).toBe('data:image/png;base64')
    expect(Array.from(atob(encoded), (character) => character.charCodeAt(0))).toEqual(uploadedBytes)

    const boundaryLog = vi.mocked(console.log).mock.calls
      .map(([value]) => typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : null)
      .find((value) => value?.event === 'workers_ai_inference_boundary')
    expect(boundaryLog).toMatchObject({
      model: '@cf/moondream/moondream3.1-9B-A2B',
      task: 'query',
      image: {
        type: 'string',
        is_array: false,
        constructor: 'String',
        byte_length: uploadedBytes.length,
      },
      question_length: expect.any(Number),
      max_tokens: 8_000,
    })
  })

  it('uses prompt-sized two-pass matching for a production-sized catalogue', async () => {
    const largeCatalog = [
      ...catalog,
      ...Array.from({ length: 304 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `Diagnostic Course ${String(index).padStart(3, '0')}`,
      })),
    ]
    mockSupabase([], 200, largeCatalog)
    const calls: AiRunCall[] = []
    const firstPassEntry = {
      ...validEntry,
      course_id: null,
      canonical_course_name: null,
      course_match_confidence: 0,
    }

    const response = await handleRequest(
      requestWithImages([image()]),
      createEnv([aiResult([firstPassEntry]), aiResult()], [], calls),
    )

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
    const firstInput = calls[0].input as { image: string; question: string }
    const candidateInput = calls[1].input as { image: string; question: string }
    expect(firstInput.question).not.toContain(AP_STATS_ID)
    expect(candidateInput.question).toContain('fuzzy candidates')
    expect(candidateInput.question).toContain(AP_STATS_ID)
    expect(candidateInput.question.length).toBeLessThanOrEqual(7_500)
    expect(candidateInput.image).toBe(firstInput.image)

    const allowedIds = new Set(largeCatalog.map((course) => course.id))
    const suppliedIds = candidateInput.question
      .split('ACTIVE CATALOGUE:\n')[1]
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' | ', 1)[0])
    expect(suppliedIds.length).toBeGreaterThan(0)
    expect(suppliedIds.every((id) => allowedIds.has(id))).toBe(true)
  })

  it('processes two images and merges overlapping entries without duplicates', async () => {
    const response = await handleRequest(
      requestWithImages([image('first.png'), image('second.webp', 'image/webp')]),
      createEnv([aiResult(), aiResult()]),
    )
    const result = await body(response)
    expect(response.status).toBe(200)
    expect(result.image_count).toBe(2)
    expect(result.rows).toHaveLength(1)
    expect((result.rows as Array<{ flags: string[] }>)[0].flags).toContain('duplicate')
  })

  it('rejects unsupported and oversized files before AI processing', async () => {
    const unsupported = await handleRequest(requestWithImages([image('schedule.gif', 'image/gif')]), createEnv())
    expect(unsupported.status).toBe(415)
    expect(await body(unsupported)).toMatchObject({ error: 'unsupported_file_type' })

    const oversized = await handleRequest(requestWithImages([image('large.png', 'image/png', 5 * 1024 * 1024 + 1)]), createEnv())
    expect(oversized.status).toBe(413)
    expect(await body(oversized)).toMatchObject({ error: 'image_too_large' })
  })

  it('enforces a per-user KV rate limit', async () => {
    const env = createEnv()
    env.RATE_LIMIT_MAX = '1'
    const first = await handleRequest(requestWithImages([image()]), env, { now: () => 1_000 })
    const second = await handleRequest(requestWithImages([image()]), env, { now: () => 1_000 })
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(await body(second)).toMatchObject({ error: 'rate_limit_exceeded' })
  })
})

describe('extraction safeguards and matching', () => {
  it('rejects screenshots whose course rows have no visible period mapping', async () => {
    const missing = aiResult([{ ...validEntry, meeting_slots: [] }], { period_mapping_visible: false })
    const response = await handleRequest(requestWithImages([image()]), createEnv([missing]))
    expect(response.status).toBe(422)
    expect(await body(response)).toMatchObject({ error: 'schedule_periods_missing' })
  })

  it('normalizes PowerSchool teachers and special classes without first names', () => {
    expect(parseTeacherLastName('Smith, John')).toBe('Smith')
    expect(parseTeacherLastName('Email Walters, Christine - Rm: S229')).toBe('Walters')
    expect(parseTeacherLastName('Staff, Unassigned')).toBe('N/A')
    expect(parseTeacherLastName('Lester, Luke', 'Lunch (SEM 1)')).toBe('N/A')
    expect(parseTeacherLastName('Maddix, Dana', 'Study Hall')).toBe('N/A')
  })

  it('matches decorated course text only to an existing canonical catalogue row', async () => {
    const response = await handleRequest(requestWithImages([image()]), createEnv())
    const result = await body(response) as { rows: Array<{ course: { id: string; name: string }; teacher_last_name: string }> }
    expect(result.rows[0].course).toEqual({ id: AP_STATS_ID, name: 'AP Statistics', confidence: 0.99 })
    expect(result.rows[0].teacher_last_name).toBe('Lester')
  })

  it('keeps an unreliable or non-catalogue course unresolved', async () => {
    const unresolved = aiResult([{
      ...validEntry,
      source_course_name: 'Advanced Mystery Seminar',
      course_id: null,
      canonical_course_name: null,
      course_match_confidence: 0,
    }])
    const response = await handleRequest(requestWithImages([image()]), createEnv([unresolved]))
    const result = await body(response) as { rows: Array<{ course: null; resolution: string; flags: string[] }> }
    expect(result.rows[0].course).toBeNull()
    expect(result.rows[0].resolution).toBe('unresolved_course')
    expect(result.rows[0].flags).toContain('unresolved_course')
  })

  it('matches an existing class only when course, teacher, term, and slots all agree', async () => {
    const classes = [{
      id: CLASS_ID,
      course_name_id: AP_STATS_ID,
      teacher_last_name: 'Lester',
      default_academic_term: 'full_year',
      is_double_period: false,
      class_meeting_slots: validEntry.meeting_slots,
    }]
    const response = await handleRequest(
      requestWithImages([image()]),
      createEnv([aiResult()], classes),
    )
    const result = await body(response) as { rows: Array<{ resolution: string; existing_class_id: string }> }
    expect(result.rows[0]).toMatchObject({ resolution: 'existing_class', existing_class_id: CLASS_ID })
  })

  it('proposes a new class only with an existing course UUID and canonical name', async () => {
    const response = await handleRequest(requestWithImages([image()]), createEnv())
    const result = await body(response) as { rows: Array<{ resolution: string; course: { id: string; name: string } }> }
    expect(result.rows[0].resolution).toBe('new_class')
    expect(result.rows[0].course).toMatchObject({ id: AP_STATS_ID, name: 'AP Statistics' })
  })

  it('does not accept an AI-invented course ID or arbitrary canonical name', async () => {
    const invented = aiResult([{
      ...validEntry,
      source_course_name: 'Advanced Mystery Seminar',
      course_id: '99999999-9999-4999-8999-999999999999',
      canonical_course_name: 'AI Invented Course',
      course_match_confidence: 1,
    }])
    const response = await handleRequest(requestWithImages([image()]), createEnv([invented]))
    const result = await body(response) as { rows: Array<{ course: null }> }
    expect(result.rows[0].course).toBeNull()
  })
})

describe('model failure handling', () => {
  it('rejects malformed model output with a structured error', async () => {
    const response = await handleRequest(requestWithImages([image()]), createEnv(['not-json']))
    expect(response.status).toBe(502)
    expect(await body(response)).toMatchObject({ error: 'ai_invalid_response' })
  })

  it('maps AI quota and generic failures to safe service errors', async () => {
    const quota = await handleRequest(requestWithImages([image()]), createEnv([new Error('429 quota exceeded')]))
    expect(quota.status).toBe(503)
    expect(await body(quota)).toMatchObject({ error: 'ai_quota_exceeded' })

    const failure = await handleRequest(requestWithImages([image()]), createEnv([new Error('daemon down')]))
    expect(failure.status).toBe(503)
    expect(await body(failure)).toMatchObject({ error: 'ai_unavailable' })
  })
})
