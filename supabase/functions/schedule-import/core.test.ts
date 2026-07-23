import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPrompt,
  findCourseMatch,
  handleScheduleImportRequest,
  normalizeSlots,
  normalizeTerm,
  parseGeminiSchedule,
  type CourseRecord,
  type DiagnosticPayload,
  type ExistingClassRecord,
  type ImportConfiguration,
  type ScheduleImportDependencies,
} from './core'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COURSE_ID = '11111111-1111-4111-8111-111111111111'
const CLASS_ID = '22222222-2222-4222-8222-222222222222'
const LOG_ID = '33333333-3333-4333-8333-333333333333'
const ORIGIN = 'http://localhost:5173'
const TOKEN = 'header.payload.signature-sensitive-token'
const API_KEY = 'gemini-api-key-sensitive'

const catalog: CourseRecord[] = [
  { id: COURSE_ID, name: 'AP Biology', term_policy: 'full_year' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Lunch - NASH', term_policy: 'lunch' },
  { id: '44444444-4444-4444-9444-444444444444', name: 'Lunch - NAI', term_policy: 'lunch' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Study Hall - NASH', term_policy: 'flexible_attendance' },
  { id: '88888888-8888-4888-8888-888888888888', name: 'Gym', term_policy: 'flexible_attendance' },
  { id: '99999999-9999-4999-8999-999999999999', name: 'English 2', term_policy: 'full_year' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: 'Business Communications', term_policy: 'semester' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', name: 'Business Management', term_policy: 'semester' },
]

const transcription = {
  schedule: true,
  issue: '',
  rows: [{
    course: 'AP Biology (CHS)',
    teacher: 'Spak, Jill',
    term: 'FY',
    slots: ['A1', 'B1', 'A2'],
  }],
}

function geminiResponse(output: unknown = transcription): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }] } }] })
}

function png(name = 'schedule.png'): File {
  return new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], name, { type: 'image/png' })
}

function jpeg(name = 'schedule.jpg'): File {
  return new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])], name, { type: 'image/jpeg' })
}

function request(files: File[], options: {
  token?: string
  apiKey?: string
  origin?: string
  developerMode?: boolean
  model?: string
  thinkingLevel?: string
} = {}): Request {
  const body = new FormData()
  files.forEach((file) => body.append('images', file))
  body.set('import_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  if (options.developerMode !== undefined) body.set('developer_mode', String(options.developerMode))
  if (options.model) body.set('model', options.model)
  if (options.thinkingLevel) body.set('thinking_level', options.thinkingLevel)
  const headers = new Headers({ Origin: options.origin ?? ORIGIN })
  if (options.token !== '') headers.set('Authorization', `Bearer ${options.token ?? TOKEN}`)
  if (options.apiKey) headers.set('apikey', options.apiKey)
  return new Request('https://project.supabase.co/functions/v1/schedule-import', { method: 'POST', headers, body })
}

function config(overrides: Partial<ImportConfiguration> = {}): ImportConfiguration {
  return {
    user_id: USER_ID,
    grade: 11,
    is_guest: false,
    is_admin: false,
    bypassed_rate_limit: false,
    model_id: 'gemini-3.5-flash-lite',
    thinking_level: 'low',
    output_token_limit: 4096,
    ...overrides,
  }
}

function dependencies(options: {
  output?: unknown
  classes?: ExistingClassRecord[]
  config?: ImportConfiguration
  fetch?: typeof fetch
  prepare?: ScheduleImportDependencies['prepareImport']
  requester?: { userId: string | null; guestKey: string | null }
  matchCount?: number
  diagnostic?: (payload: DiagnosticPayload) => void
} = {}): ScheduleImportDependencies {
  return {
    geminiApiKey: API_KEY,
    resolveRequester: vi.fn(async () => options.requester ?? ({ userId: USER_ID, guestKey: null })),
    prepareImport: options.prepare ?? vi.fn(async () => options.config ?? config()),
    loadCatalog: vi.fn(async () => catalog),
    loadClasses: vi.fn(async () => options.classes ?? []),
    countGuestMatches: vi.fn(async () => options.matchCount ?? 0),
    recordDiagnostic: vi.fn(async (_token, payload) => {
      options.diagnostic?.(payload)
      return LOG_ID
    }),
    fetch: options.fetch ?? vi.fn(async () => geminiResponse(options.output)),
    randomUUID: () => '66666666-6666-4666-8666-666666666666',
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Gemini request and response handling', () => {
  it('sends one image with low thinking, structured JSON, and no catalogue text', async () => {
    const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>
      expect(body.generationConfig).toMatchObject({
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false },
      })
      expect(body.generationConfig.responseJsonSchema).toMatchObject({ required: ['schedule', 'issue', 'rows'] })
      const parts = body.contents[0].parts as Array<Record<string, unknown>>
      expect(parts).toHaveLength(2)
      expect(parts[1]).toHaveProperty('inlineData.mimeType', 'image/png')
      const prompt = String((parts[0] as { text: string }).text)
      expect(prompt).toContain('Never infer periods from row order')
      expect(prompt).toContain('assign the other row to the complementary semester')
      expect(prompt).not.toContain(COURSE_ID)
      expect(prompt).not.toContain('ACTIVE CATALOGUE')
      return geminiResponse()
    })
    const response = await handleScheduleImportRequest(request([png()]), dependencies({ fetch: providerFetch }))
    expect(response.status).toBe(200)
    const body = await responseBody(response)
    expect(body.image_count).toBe(1)
    expect(body).toMatchObject({ retry_count: 0, retry_reasons: [] })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(body.rows).toEqual([expect.objectContaining({
      course: expect.objectContaining({ id: COURSE_ID, name: 'AP Biology', confidence: 1, term_policy: 'full_year' }),
      teacher_last_name: 'Spak',
      term: 'full_year',
      meeting_slots: [
        { day_type: 'A', period_number: 1 },
        { day_type: 'A', period_number: 2 },
        { day_type: 'B', period_number: 1 },
      ],
      resolution: 'new_class',
    })])
  })

  it('continues the Gemini conversation once when the first read conflicts', async () => {
    const firstRead = {
      schedule: true,
      issue: '',
      rows: [
        { course: 'AP Biology (CHS)', teacher: 'Spak, Jill', term: 'FY', slots: ['A1'] },
        { course: 'English 2', teacher: 'Jones, Alex', term: 'FY', slots: ['A1'] },
      ],
    }
    const correctedRead = {
      ...firstRead,
      rows: [firstRead.rows[0], { ...firstRead.rows[1], slots: ['A2'] }],
    }
    const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ role: string; parts: Array<{ text?: string }> }> }
      if (providerFetch.mock.calls.length === 1) {
        expect(body.contents).toHaveLength(1)
        return geminiResponse(firstRead)
      }
      expect(body.contents).toHaveLength(3)
      expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: JSON.stringify(firstRead) }] })
      expect(body.contents[2].parts[0].text).toContain('conflict remains')
      return geminiResponse(correctedRead)
    })
    const deps = dependencies({ fetch: providerFetch })

    const response = await handleScheduleImportRequest(request([png()]), deps)
    const body = await responseBody(response)

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(body).toMatchObject({ retry_count: 1, retry_reasons: [expect.stringContaining('conflict remains')] })
    expect(body.rows).toEqual([
      expect.objectContaining({ source_course_name: 'AP Biology (CHS)', meeting_slots: [{ day_type: 'A', period_number: 1 }] }),
      expect.objectContaining({ source_course_name: 'English 2', meeting_slots: [{ day_type: 'A', period_number: 2 }] }),
    ])
    expect(deps.loadClasses).toHaveBeenCalledWith(TOKEN, expect.any(Object), expect.arrayContaining([COURSE_ID, '99999999-9999-4999-8999-999999999999']))
  })

  it('asks Gemini to fill an unresolved half-credit term, but never retries a clean result', async () => {
    const firstRead = {
      schedule: true,
      issue: '',
      rows: [{ course: 'Business Communications', teacher: 'Sestili', term: 'unknown', slots: ['A5', 'B5'] }],
    }
    const correctedRead = {
      ...firstRead,
      rows: [{ ...firstRead.rows[0], term: 'S1' }],
    }
    const providerFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse(firstRead))
      .mockResolvedValueOnce(geminiResponse(correctedRead))

    const response = await handleScheduleImportRequest(request([png()]), dependencies({ fetch: providerFetch }))
    const body = await responseBody(response)

    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(body).toMatchObject({ retry_count: 1, retry_reasons: [expect.stringContaining('incomplete')] })
    expect(body.rows).toEqual([expect.objectContaining({ term: 'semester_1', flags: [] })])
  })

  it('passes three images in one Gemini request', async () => {
    const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>
      expect(body.contents[0].parts).toHaveLength(4)
      return geminiResponse()
    })
    const response = await handleScheduleImportRequest(request([png('first.png'), jpeg('second.jpg'), png('third.png')]), dependencies({ fetch: providerFetch }))
    expect(response.status).toBe(200)
    expect((await responseBody(response)).image_count).toBe(3)
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects more than three images before calling Gemini', async () => {
    const providerFetch = vi.fn<typeof fetch>()
    const response = await handleScheduleImportRequest(request([
      png('first.png'),
      png('second.png'),
      png('third.png'),
      png('fourth.png'),
    ]), dependencies({ fetch: providerFetch }))
    expect(response.status).toBe(400)
    expect(await responseBody(response)).toMatchObject({ error: 'invalid_image_count' })
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('rejects malformed, incomplete, and extra model output', async () => {
    for (const output of [
      'not-json',
      { schedule: true, issue: '', rows: [{ course: 'AP Biology', teacher: 'Spak', term: 'FY' }] },
      { schedule: true, issue: '', rows: [{ ...transcription.rows[0], catalogue_id: COURSE_ID }] },
    ]) {
      const response = await handleScheduleImportRequest(request([png()]), dependencies({ output }))
      expect(response.status).toBe(502)
      expect(await responseBody(response)).toMatchObject({ error: 'ai_invalid_response' })
    }
  })

  it('parses only the required structured shape', () => {
    expect(parseGeminiSchedule(JSON.stringify(transcription))).toEqual(transcription)
    expect(() => parseGeminiSchedule(JSON.stringify({ ...transcription, secret: 'no' }))).toThrow('invalid structured data')
  })

  it('returns the model\'s actionable screenshot problem to the user', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      output: { schedule: false, issue: 'The period column is cropped out. Include the period numbers and course names.', rows: [] },
    }))
    expect(response.status).toBe(422)
    expect(await responseBody(response)).toMatchObject({
      error: 'schedule_not_detected',
      message: expect.stringContaining('The period column is cropped out'),
    })
  })
})

describe('normalization and backend catalogue matching', () => {
  it('normalizes visible terms and supported slot formats', () => {
    expect(normalizeTerm('25-26')).toBe('full_year')
    expect(normalizeTerm('FY/PT')).toBe('full_year')
    expect(normalizeTerm('SEM 1')).toBe('semester_1')
    expect(normalizeTerm('Semester 2')).toBe('semester_2')
    expect(normalizeTerm('not visible')).toBe('unknown')
    expect(normalizeTerm('')).toBe('unknown')
    expect(normalizeSlots(['P01(A-B)', 'A Day Period 2', 'B2'])).toEqual([
      { day_type: 'A', period_number: 1 },
      { day_type: 'A', period_number: 2 },
      { day_type: 'B', period_number: 1 },
      { day_type: 'B', period_number: 2 },
    ])
    expect(normalizeSlots(['B4'])).toEqual([{ day_type: 'B', period_number: 4 }])
  })

  it('rejects invalid, out-of-range, and nonconsecutive slots', () => {
    expect(() => normalizeSlots(['A0'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['A1', 'A3'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['C2'])).toThrow('invalid meeting slots')
  })

  it('keeps the same course and teacher at different periods as separate rows', async () => {
    const response = await handleScheduleImportRequest(request([png(), png()]), dependencies({
      output: {
        schedule: true,
        issue: '',
        rows: [
          { course: 'AP Biology (CHS)', teacher: 'Spak, Jill', term: 'FY', slots: ['A1'] },
          { course: 'AP Biology (CHS)', teacher: 'Spak, Jill', term: 'FY', slots: ['A3'] },
        ],
      },
    }))
    expect(response.status).toBe(200)
    expect((await responseBody(response)).rows).toEqual([
      expect.objectContaining({ meeting_slots: [{ day_type: 'A', period_number: 1 }] }),
      expect.objectContaining({ meeting_slots: [{ day_type: 'A', period_number: 3 }] }),
    ])
  })

  it('still merges exact duplicate screenshot rows', async () => {
    const duplicateRow = { course: 'AP Biology (CHS)', teacher: 'Spak, Jill', term: 'FY', slots: ['A2', 'B2'] }
    const response = await handleScheduleImportRequest(request([png(), png()]), dependencies({
      output: { schedule: true, issue: '', rows: [duplicateRow, duplicateRow] },
    }))
    expect(response.status).toBe(200)
    expect((await responseBody(response)).rows).toEqual([
      expect.objectContaining({
        meeting_slots: [{ day_type: 'A', period_number: 2 }, { day_type: 'B', period_number: 2 }],
        flags: expect.arrayContaining(['duplicate']),
      }),
    ])
  })

  it('defaults a missing term to full year but preserves explicit semester markers in course names', async () => {
    const defaulted = await handleScheduleImportRequest(request([png()]), dependencies({
      output: {
        schedule: true,
        issue: '',
        rows: [{ course: 'AP Biology (CHS)', teacher: 'Spak, Jill', term: '', slots: ['A2', 'B2'] }],
      },
    }))
    expect((await responseBody(defaulted)).rows).toEqual([
      expect.objectContaining({
        term: 'full_year',
        warnings: [expect.stringContaining('full-year course')],
      }),
    ])

    const semesters = await handleScheduleImportRequest(request([png()]), dependencies({
      output: {
        schedule: true,
        issue: '',
        rows: [
          { course: 'Lunch (SEM 1)', teacher: 'Staff, Unassigned', term: 'FY', slots: ['P07(A-B)'] },
          { course: 'Lunch (SEM 2)', teacher: 'Staff, Unassigned', term: '', slots: ['P07(A-B)'] },
        ],
      },
    }))
    expect((await responseBody(semesters)).rows).toEqual([
      expect.objectContaining({ term: 'semester_1', teacher_last_name: 'N/A' }),
      expect.objectContaining({ term: 'semester_2', teacher_last_name: 'N/A' }),
    ])
  })

  it('uses the authenticated grade and keeps same-period full-year lunch as one entry', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      config: config({ grade: 10 }),
      output: {
        schedule: true,
        issue: '',
        rows: [{ course: 'Lunch', teacher: 'Staff, Unassigned', term: 'FY', slots: ['P04(A-B)'] }],
      },
    }))
    expect(response.status).toBe(200)
    expect((await responseBody(response)).rows).toEqual([
      expect.objectContaining({ course: expect.objectContaining({ name: 'Lunch - NAI', term_policy: 'lunch' }), term: 'full_year', teacher_last_name: 'N/A' }),
    ])
  })

  it('keeps campus names hidden for guests and returns only one aggregate match count', async () => {
    const lunchCourseId = '44444444-4444-4444-9444-444444444444'
    const semesterOneClassId = '77777777-7777-4777-8777-777777777771'
    const semesterTwoClassId = '77777777-7777-4777-8777-777777777772'
    const guestDependencies = dependencies({
      requester: { userId: null, guestKey: 'a'.repeat(64) },
      config: config({ user_id: null, grade: null, is_guest: true }),
      matchCount: 7,
      classes: [
        { id: semesterOneClassId, course_name_id: lunchCourseId, teacher_last_name: 'N/A', default_academic_term: 'semester_1', meeting_slots: [{ day_type: 'A', period_number: 4 }, { day_type: 'B', period_number: 4 }] },
        { id: semesterTwoClassId, course_name_id: lunchCourseId, teacher_last_name: 'N/A', default_academic_term: 'semester_2', meeting_slots: [{ day_type: 'A', period_number: 4 }, { day_type: 'B', period_number: 4 }] },
      ],
      output: {
        schedule: true,
        issue: '',
        rows: [
          { course: 'English 2', teacher: 'Jones', term: 'FY', slots: ['A1', 'B1'] },
          { course: 'Lunch', teacher: 'Staff, Unassigned', term: 'FY', slots: ['A4', 'B4'] },
        ],
      },
    })
    const response = await handleScheduleImportRequest(request([png()]), guestDependencies)
    const body = await responseBody(response)
    expect(body).toMatchObject({ estimated_grade: 10, shared_student_count: 7 })
    expect((body.rows as Array<{ course: { name: string } }>).filter((row) => row.course.name === 'Lunch')).toHaveLength(1)
    expect(guestDependencies.countGuestMatches).toHaveBeenCalledWith([semesterOneClassId])
  })

  it('infers grade 12 from AP English Literature for guest campus matching', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      requester: { userId: null, guestKey: 'c'.repeat(64) },
      config: config({ user_id: null, grade: null, is_guest: true }),
      output: {
        schedule: true,
        issue: '',
        rows: [{ course: 'AP English Literature', teacher: 'Morrison', term: 'FY', slots: ['A2', 'B2'] }],
      },
    }))
    expect(await responseBody(response)).toMatchObject({ estimated_grade: 12 })
  })

  it('infers complementary semesters for distinct courses in the same complete meeting slot', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      output: {
        schedule: true,
        issue: '',
        rows: [
          { course: 'Business Communications (CHS)', teacher: 'Sestili, Christopher', term: 'unknown', slots: ['P05(A-B)'] },
          { course: 'Lunch (SEM 2)', teacher: 'Staff, Unassigned', term: 'S2', slots: ['P05(A-B)'] },
          { course: 'Lunch (SEM 1)', teacher: 'Staff, Unassigned', term: 'S1', slots: ['P07(A-B)'] },
          { course: 'Business Management', teacher: 'Sorisio, John', term: 'unknown', slots: ['P07(A-B)'] },
        ],
      },
    }))
    const rows = (await responseBody(response)).rows as Array<{ source_course_name: string; term: string; warnings: string[] }>
    expect(rows.find((row) => row.source_course_name.startsWith('Business Communications'))).toMatchObject({
      term: 'semester_1',
      warnings: [expect.stringContaining('complementary semester')],
    })
    expect(rows.find((row) => row.source_course_name === 'Business Management')).toMatchObject({
      term: 'semester_2',
      warnings: [expect.stringContaining('complementary semester')],
    })
  })

  it('normalizes explicit semester spellings without defaulting them to full year', () => {
    expect(['SEM 1', 'Semester 1', 'S1'].map(normalizeTerm)).toEqual(Array(3).fill('semester_1'))
    expect(['SEM 2', 'Semester 2', 'S2'].map(normalizeTerm)).toEqual(Array(3).fill('semester_2'))
    expect(['', 'unknown', 'not visible', 'N/A'].map(normalizeTerm)).toEqual(Array(4).fill('unknown'))
  })

  it('maps PowerSchool Health & PE variants to the Gym catalogue course', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      output: {
        schedule: true,
        issue: '',
        rows: [{ course: 'Health & PE (FY/PT) 11', teacher: 'Winters, Heather', term: '', slots: ['P02(A)'] }],
      },
    }))
    expect((await responseBody(response)).rows).toEqual([
      expect.objectContaining({
        course: expect.objectContaining({ id: '88888888-8888-4888-8888-888888888888', name: 'Gym', confidence: 1, term_policy: 'flexible_attendance' }),
        teacher_last_name: 'Winters',
        term: 'full_year',
      }),
    ])

    for (const powerSchoolName of [
      'Health & PE',
      'Health and PE',
      'Health/PE',
      'Health and Physical Education',
      'Health & P.E.',
      'Health / Phys. Ed.',
      'Health - PE (FY/PT) 11',
    ]) {
      expect(findCourseMatch(powerSchoolName, catalog)).toMatchObject({
        kind: 'matched',
        course: { id: '88888888-8888-4888-8888-888888888888', name: 'Gym' },
        score: 1,
      })
    }
  })

  it('fuzzy matches decorated course names on the backend', () => {
    expect(findCourseMatch('AP Biology (CHS)', catalog)).toMatchObject({
      kind: 'matched',
      course: { id: COURSE_ID, name: 'AP Biology' },
      score: 1,
    })
  })

  it('keeps unknown and ambiguous courses unresolved for review', async () => {
    const unresolved = await handleScheduleImportRequest(request([png()]), dependencies({
      output: { ...transcription, rows: [{ ...transcription.rows[0], course: 'Advanced Mystery Seminar' }] },
    }))
    expect((await responseBody(unresolved)).rows).toEqual([expect.objectContaining({
      course: null,
      resolution: 'unresolved_course',
      flags: expect.arrayContaining(['unresolved_course']),
    })])

    const ambiguousCatalog = [
      { id: COURSE_ID, name: 'Algebra Support' },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Algebra Seminar' },
    ]
    const deps = dependencies({ output: { ...transcription, rows: [{ ...transcription.rows[0], course: 'Algebra' }] } })
    deps.loadCatalog = vi.fn(async () => ambiguousCatalog)
    const ambiguous = await handleScheduleImportRequest(request([png()]), deps)
    expect((await responseBody(ambiguous)).rows).toEqual([expect.objectContaining({
      course: null,
      flags: expect.arrayContaining(['ambiguous_course', 'unresolved_course']),
      warnings: [expect.stringContaining('ambiguous')],
    })])
  })

  it('matches an existing class only when course, teacher, term, and every slot agree', async () => {
    const exactClass: ExistingClassRecord = {
      id: CLASS_ID,
      course_name_id: COURSE_ID,
      teacher_last_name: 'Spak',
      default_academic_term: 'full_year',
      meeting_slots: [
        { day_type: 'A', period_number: 1 },
        { day_type: 'A', period_number: 2 },
        { day_type: 'B', period_number: 1 },
      ],
    }
    const exact = await handleScheduleImportRequest(request([png()]), dependencies({ classes: [exactClass] }))
    expect((await responseBody(exact)).rows).toEqual([expect.objectContaining({
      resolution: 'existing_class',
      existing_class_id: CLASS_ID,
    })])

    const mismatch = await handleScheduleImportRequest(request([png()]), dependencies({
      classes: [{ ...exactClass, default_academic_term: 'semester_1' }],
    }))
    expect((await responseBody(mismatch)).rows).toEqual([expect.objectContaining({
      resolution: 'new_class',
      existing_class_id: null,
    })])
  })
})

describe('authentication, CORS, files, and rate limiting', () => {
  it('accepts the publishable key for guests and server-validates signed-in access tokens', async () => {
    const missing = await handleScheduleImportRequest(request([png()], { token: '' }), dependencies())
    expect(missing.status).toBe(401)
    expect(await responseBody(missing)).toMatchObject({ error: 'authentication_required' })

    const guestDeps = dependencies()
    const guest = await handleScheduleImportRequest(request([png()], { token: '', apiKey: 'publishable-key' }), guestDeps)
    expect(guest.status).toBe(200)
    expect(guestDeps.resolveRequester).toHaveBeenCalledWith('publishable-key', expect.any(Request))

    const deps = dependencies()
    deps.resolveRequester = vi.fn(async () => { throw new Error('expired') })
    const expired = await handleScheduleImportRequest(request([png()]), deps)
    expect(expired.status).toBe(401)
    expect(await responseBody(expired)).toMatchObject({ error: 'session_expired' })
  })

  it('handles allowed preflight requests and rejects unapproved origins', async () => {
    const preflightDependencies = dependencies()
    delete preflightDependencies.randomUUID
    const preflight = await handleScheduleImportRequest(new Request('https://project.supabase.co/functions/v1/schedule-import', {
      method: 'OPTIONS', headers: { Origin: ORIGIN },
    }), preflightDependencies)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const blocked = await handleScheduleImportRequest(request([png()], { origin: 'https://attacker.example' }), dependencies())
    expect(blocked.status).toBe(403)
    expect(blocked.headers.get('Access-Control-Allow-Origin')).not.toBe('https://attacker.example')
  })

  it('validates file count, MIME, size, and magic bytes before provider use', async () => {
    const empty = await handleScheduleImportRequest(request([]), dependencies())
    expect(empty.status).toBe(400)
    const unsupported = await handleScheduleImportRequest(request([new File(['GIF89a'], 'bad.gif', { type: 'image/gif' })]), dependencies())
    expect(unsupported.status).toBe(415)
    const fakePng = await handleScheduleImportRequest(request([new File(['not png'], 'bad.png', { type: 'image/png' })]), dependencies())
    expect(fakePng.status).toBe(415)
    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    const oversized = await handleScheduleImportRequest(request([large]), dependencies())
    expect(oversized.status).toBe(413)
  })

  it('maps the database-backed regular-user rate limit safely', async () => {
    const response = await handleScheduleImportRequest(request([png()]), dependencies({
      prepare: vi.fn(async () => { throw new Error('rate_limit_exceeded') }),
    }))
    expect(response.status).toBe(429)
    expect(await responseBody(response)).toMatchObject({ error: 'rate_limit_exceeded' })
  })
})

describe('administrator developer mode and provider failures', () => {
  it('denies developer options to regular users and never returns developer data', async () => {
    const response = await handleScheduleImportRequest(request([png()], {
      developerMode: true,
      model: 'gemini-3.5-flash',
      thinkingLevel: 'high',
    }), dependencies({
      prepare: vi.fn(async () => { throw new Error('developer_mode_administrator_required') }),
    }))
    expect(response.status).toBe(403)
    expect(await responseBody(response)).not.toHaveProperty('developer')
  })

  it('allows a verified admin model override, bypasses only the app limit, and stores diagnostics', async () => {
    let recorded: DiagnosticPayload | null = null
    const deps = dependencies({
      config: config({
        is_admin: true,
        bypassed_rate_limit: true,
        model_id: 'gemini-3.5-flash',
        thinking_level: 'high',
      }),
      diagnostic: (payload) => { recorded = payload },
    })
    const response = await handleScheduleImportRequest(request([png()], {
      developerMode: true,
      model: 'gemini-3.5-flash',
      thinkingLevel: 'high',
    }), deps)
    expect(response.status).toBe(200)
    const body = await responseBody(response)
    expect(body.developer).toMatchObject({
      prompt: buildPrompt(),
      raw_gemini_output: JSON.stringify(transcription),
      parsed_output: transcription,
      validation_errors: [],
      model: 'gemini-3.5-flash',
      thinking_level: 'high',
      diagnostic_log_id: LOG_ID,
    })
    expect(recorded).toMatchObject({ status: 'success', image_metadata: [{ index: 1, mime_type: 'image/png', byte_size: 12 }] })
  })

  it('never logs image bytes, tokens, or secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await handleScheduleImportRequest(request([png()]), dependencies())
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    const combined = JSON.stringify([...log.mock.calls, ...error.mock.calls])
    expect(combined).not.toContain(TOKEN)
    expect(combined).not.toContain(API_KEY)
    expect(combined).not.toContain('iVBOR')
  })

  it('maps quota, timeout, and provider errors and exposes sanitized details only to admins', async () => {
    const quota = await handleScheduleImportRequest(request([png()]), dependencies({
      fetch: vi.fn(async () => Response.json({ error: { message: `quota ${API_KEY}` } }, { status: 429 })),
    }))
    expect(quota.status).toBe(503)
    expect(await responseBody(quota)).toEqual(expect.objectContaining({ error: 'ai_quota_exceeded' }))

    const timeout = await handleScheduleImportRequest(request([png()]), dependencies({
      fetch: vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }),
    }))
    expect(timeout.status).toBe(504)
    expect(await responseBody(timeout)).toMatchObject({ error: 'ai_timeout' })

    const admin = config({ is_admin: true, bypassed_rate_limit: true })
    const provider = await handleScheduleImportRequest(request([png()], { developerMode: true }), dependencies({
      config: admin,
      fetch: vi.fn(async () => Response.json({
        error: { message: `Authorization: Bearer ${TOKEN}`, api_key: API_KEY, image_bytes: 'abc' },
      }, { status: 500 })),
    }))
    expect(provider.status).toBe(502)
    const providerBody = JSON.stringify(await responseBody(provider))
    expect(providerBody).toContain('[REDACTED]')
    expect(providerBody).not.toContain(TOKEN)
    expect(providerBody).not.toContain(API_KEY)
    expect(providerBody).not.toContain('image_bytes":"abc')
  })
})
