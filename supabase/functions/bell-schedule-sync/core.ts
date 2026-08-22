export const BELL_SYNC_TIMEOUT_MS = 45_000
export const SCHOOL_TIME_ZONE = 'America/New_York'

export interface BellSyncClaim {
  claimed: boolean
  reason?: string
  run_id?: string
  model_id?: string
  preview?: boolean
  school_year_start?: string
  school_year_end?: string
  bell_schedule_document_url?: string
  newsletter_document_url?: string
}

export interface BellSyncExtraction {
  date: string
  day_type: 'A' | 'B' | null
  no_school: boolean
  schedule_key: string
  campus: 'BOTH' | 'NAI' | 'NASH'
  evidence: string
}

export interface BellSyncFinishInput {
  runId: string
  status: 'previewed' | 'succeeded' | 'skipped' | 'failed'
  sourceHash: string | null
  sourceSection: string | null
  rawJson: unknown
  validated: BellSyncExtraction[]
  error: string | null
  timingMs: number
}

export interface BellSyncDependencies {
  googleDocsApiKey: string
  geminiApiKey: string
  schedulerToken: string
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  verifyUser: (token: string) => Promise<{ id: string }>
  verifyAdmin: (token: string) => Promise<boolean>
  claim: (actorId: string | null, trigger: 'manual' | 'scheduled', preview: boolean) => Promise<BellSyncClaim>
  finish: (input: BellSyncFinishInput) => Promise<Record<string, unknown>>
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

const knownScheduleKeys = new Set([
  'regular',
  'two_hour_delay',
  'half_day',
  'nash_early_dismissal',
  'nai_early_dismissal',
  'activity_1',
  'activity_2',
  'reverse_activity_1',
  'reverse_activity_2',
  'reverse_activity_3',
])

const responseSchema = {
  type: 'array',
  maxItems: 30,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      date: { type: 'string', description: 'ISO date in YYYY-MM-DD form.' },
      day_type: { type: ['string', 'null'], enum: ['A', 'B', null] },
      no_school: { type: 'boolean' },
      schedule_key: { type: 'string', enum: [...knownScheduleKeys] },
      campus: { type: 'string', enum: ['BOTH', 'NAI', 'NASH'] },
      evidence: { type: 'string', maxLength: 500 },
    },
    required: ['date', 'day_type', 'no_school', 'schedule_key', 'campus', 'evidence'],
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textFromStructuralElements(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const output: string[] = []
  for (const structural of value) {
    if (!isRecord(structural)) continue
    const paragraph = isRecord(structural.paragraph) ? structural.paragraph : null
    if (paragraph && Array.isArray(paragraph.elements)) {
      for (const element of paragraph.elements) {
        if (!isRecord(element) || !isRecord(element.textRun) || typeof element.textRun.content !== 'string') continue
        output.push(element.textRun.content)
      }
    }
    const table = isRecord(structural.table) ? structural.table : null
    if (table && Array.isArray(table.tableRows)) {
      for (const row of table.tableRows) {
        if (!isRecord(row) || !Array.isArray(row.tableCells)) continue
        output.push(row.tableCells.map((cell) => isRecord(cell) ? textFromStructuralElements(cell.content) : '').join('\t'))
        output.push('\n')
      }
    }
    const tableOfContents = isRecord(structural.tableOfContents) ? structural.tableOfContents : null
    if (tableOfContents) output.push(textFromStructuralElements(tableOfContents.content))
  }
  return output.join('')
}

function textFromTab(tab: unknown): string {
  if (!isRecord(tab)) return ''
  const documentTab = isRecord(tab.documentTab) ? tab.documentTab : null
  const body = documentTab && isRecord(documentTab.body) ? documentTab.body : null
  const ownText = body ? textFromStructuralElements(body.content) : ''
  const childText = Array.isArray(tab.childTabs) ? tab.childTabs.map(textFromTab).join('\n') : ''
  return [ownText, childText].filter(Boolean).join('\n')
}

export function extractGoogleDocumentText(document: unknown): string {
  if (!isRecord(document)) throw new HttpError(502, 'invalid_google_doc', 'Google Docs returned an invalid document.')
  const tabText = Array.isArray(document.tabs) ? document.tabs.map(textFromTab).join('\n') : ''
  const legacyBody = isRecord(document.body) ? textFromStructuralElements(document.body.content) : ''
  return (tabText || legacyBody).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

function dateScore(section: string, reference: Date): number {
  const scores: number[] = []
  for (const match of section.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    scores.push(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  }
  const monthNames: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  }
  for (const match of section.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[.]?\s+(\d{1,2})(?:,\s*(20\d{2}))?/gi)) {
    const month = monthNames[match[1].toLowerCase()]
    let year = match[3] ? Number(match[3]) : reference.getUTCFullYear()
    if (!match[3] && month < reference.getUTCMonth() - 6) year += 1
    if (!match[3] && month > reference.getUTCMonth() + 6) year -= 1
    scores.push(Date.UTC(year, month, Number(match[2])))
  }
  return scores.length ? Math.max(...scores) : 0
}

export function newestWeeklyScheduleSections(text: string, reference = new Date()): string {
  const matches = [...text.matchAll(/\bWeekly Schedule\b/gi)]
  if (matches.length === 0) throw new HttpError(422, 'weekly_schedule_missing', 'No Weekly Schedule section was found in the newsletter.')
  const sections = matches.map((match, index) => text.slice(match.index, matches[index + 1]?.index ?? text.length).trim())
    .filter(Boolean)
    .map((section, index) => ({ section, index, score: dateScore(section, reference) }))
  return sections.sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.section)
    .join('\n\n')
    .slice(0, 50_000)
}

function googleDocumentId(url: string): string {
  const match = /docs[.]google[.]com\/document\/d\/([A-Za-z0-9_-]+)/.exec(url)
  if (!match) throw new HttpError(500, 'invalid_source_url', 'A configured Google Docs URL is invalid.')
  return match[1]
}

export async function fetchGoogleDocument(url: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!apiKey.trim()) throw new HttpError(503, 'google_docs_not_configured', 'The Google Docs API key is not configured.')
  const endpoint = new URL(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(googleDocumentId(url))}`)
  endpoint.searchParams.set('includeTabsContent', 'true')
  endpoint.searchParams.set('key', apiKey)
  const response = await fetcher(endpoint, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) throw new HttpError(502, 'google_docs_fetch_failed', `Google Docs could not read a configured source (${response.status}).`)
  return body
}

function buildPrompt(sourceSection: string): string {
  return `You extract school-day calendar facts from the newest North Allegheny NASH newsletter sections.

Return JSON only in the required schema. Extract only explicitly supported dates in the supplied text. For every row:
- date must be YYYY-MM-DD.
- day_type is A, B, or null when not explicitly stated.
- no_school is true only when the source explicitly closes school for that date.
- schedule_key must be one of: ${[...knownScheduleKeys].join(', ')}.
- campus is BOTH unless the source explicitly limits the item to NAI or NASH.
- evidence is a short exact quote from the source that supports the date and schedule/day classification.

Deterministic terminology rules you must follow:
- The exact whole phrase “activity period” means activity_1.
- “Activities Fair” or “Student Activities Fair” alone does not mean an activity bell schedule; keep regular unless another explicit phrase changes the schedule.
- Do not infer a delay, dismissal, activity, reverse activity, or no-school day from unrelated events.
- Do not include dates outside the supplied sections.

Newest two Weekly Schedule sections:
---
${sourceSection}
---`
}

export function buildGeminiBellSyncRequest(sourceSection: string): Record<string, unknown> {
  return {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(sourceSection) }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseJsonSchema: responseSchema,
      thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false },
    },
  }
}

function geminiResponseText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isRecord(value.candidates[0])) {
    throw new HttpError(502, 'gemini_invalid_response', 'Gemini did not return a usable candidate.')
  }
  const content = isRecord(value.candidates[0].content) ? value.candidates[0].content : null
  if (!content || !Array.isArray(content.parts)) throw new HttpError(502, 'gemini_invalid_response', 'Gemini returned an incomplete candidate.')
  const text = content.parts.filter(isRecord).map((part) => typeof part.text === 'string' ? part.text : '').join('')
  if (!text) throw new HttpError(502, 'gemini_invalid_response', 'Gemini returned no structured text.')
  return text
}

export async function invokeGeminiBellSync(
  modelId: string,
  sourceSection: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = BELL_SYNC_TIMEOUT_MS,
): Promise<{ providerJson: unknown; rawJson: unknown }> {
  if (!apiKey.trim()) throw new HttpError(503, 'gemini_not_configured', 'The Gemini API key is not configured.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiBellSyncRequest(sourceSection)),
      signal: controller.signal,
    })
    const providerJson = await response.json().catch(() => null) as unknown
    if (!response.ok) throw new HttpError(502, 'gemini_provider_error', `Gemini could not extract the newsletter (${response.status}).`)
    let rawJson: unknown
    try { rawJson = JSON.parse(geminiResponseText(providerJson)) }
    catch (caught) {
      if (caught instanceof HttpError) throw caught
      throw new HttpError(502, 'gemini_invalid_json', 'Gemini returned malformed structured JSON.')
    }
    return { providerJson, rawJson }
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') throw new HttpError(504, 'gemini_timeout', 'Gemini extraction timed out.')
    throw caught
  } finally { clearTimeout(timeout) }
}

function normalizeEvidence(value: string): string {
  return value.toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
}

function validIsoDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function validateBellSyncExtraction(
  value: unknown,
  sourceSection: string,
  schoolYearStart: string,
  schoolYearEnd: string,
  today: string,
): BellSyncExtraction[] {
  if (!Array.isArray(value) || value.length > 30) throw new HttpError(422, 'invalid_extraction', 'Gemini returned an invalid number of calendar rows.')
  const source = normalizeEvidence(sourceSection)
  const minimumDate = [schoolYearStart, addUtcDays(today, -14)].sort().at(-1) as string
  const maximumDate = [schoolYearEnd, addUtcDays(today, 35)].sort()[0]
  const seen = new Set<string>()
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new HttpError(422, 'invalid_extraction', 'Gemini returned an invalid calendar row.')
    const date = String(candidate.date ?? '')
    const evidence = String(candidate.evidence ?? '').trim()
    const normalizedEvidence = normalizeEvidence(evidence)
    const dayType = candidate.day_type === null ? null : String(candidate.day_type).toUpperCase()
    const noSchool = candidate.no_school === true
    const campus = String(candidate.campus ?? 'BOTH').toUpperCase()
    let scheduleKey = String(candidate.schedule_key ?? 'regular').toLowerCase()
    if (!validIsoDate(date) || date < minimumDate || date > maximumDate) throw new HttpError(422, 'date_out_of_bounds', `Gemini returned an out-of-bounds date: ${date || 'unknown'}.`)
    if (dayType !== null && dayType !== 'A' && dayType !== 'B') throw new HttpError(422, 'invalid_day_type', `Gemini returned an invalid A/B day for ${date}.`)
    if (campus !== 'BOTH' && campus !== 'NAI' && campus !== 'NASH') throw new HttpError(422, 'invalid_campus', `Gemini returned an invalid campus for ${date}.`)
    if (!normalizedEvidence || !source.includes(normalizedEvidence)) throw new HttpError(422, 'unsupported_evidence', `Gemini evidence for ${date} was not found in the source.`)
    const saysActivityPeriod = /\bactivity\s+period\b/i.test(evidence)
    const saysActivitiesFair = /\b(?:student\s+)?activities\s+fair\b/i.test(evidence)
    const saysAnotherBellSchedule = /\b(?:two[- ]hour delay|half[- ]day|early dismissal|activity bell schedule|reverse activity)\b/i.test(evidence)
    if (saysActivityPeriod) scheduleKey = 'activity_1'
    else if (saysActivitiesFair && !saysAnotherBellSchedule) scheduleKey = 'regular'
    if (!knownScheduleKeys.has(scheduleKey)) throw new HttpError(422, 'unknown_schedule_key', `Gemini returned an unknown bell schedule for ${date}.`)
    const uniqueKey = `${date}:${campus}`
    if (seen.has(uniqueKey)) throw new HttpError(422, 'duplicate_extraction_date', `Gemini returned ${date} more than once for ${campus}.`)
    seen.add(uniqueKey)
    return { date, day_type: dayType as 'A' | 'B' | null, no_school: noSchool, schedule_key: noSchool ? 'regular' : scheduleKey, campus: campus as BellSyncExtraction['campus'], evidence }
  })
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) throw new HttpError(401, 'authentication_required', 'Sign in again before running the bell-schedule detector.')
  const token = authorization.slice(7).trim()
  if (!token) throw new HttpError(401, 'authentication_required', 'Sign in again before running the bell-schedule detector.')
  return token
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bell-schedule-sync-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } })
}

function easternToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function handleBellScheduleSyncRequest(request: Request, dependencies: BellSyncDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: json(200, {}).headers })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Use POST for bell-schedule detection.' })
  const startedAt = Date.now()
  let runId: string | null = null
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scheduled = body.trigger === 'scheduled'
    const preview = !scheduled && body.preview === true
    let actorId: string | null = null
    if (scheduled) {
      const suppliedToken = request.headers.get('x-bell-schedule-sync-token') ?? ''
      if (!dependencies.schedulerToken || suppliedToken !== dependencies.schedulerToken) throw new HttpError(401, 'invalid_scheduler_token', 'The scheduled bell-sync token is invalid.')
    } else {
      const token = bearerToken(request)
      const user = await dependencies.verifyUser(token)
      if (!await dependencies.verifyAdmin(token)) throw new HttpError(403, 'administrator_access_required', 'Administrator access is required.')
      actorId = user.id
    }
    const claim = await dependencies.claim(actorId, scheduled ? 'scheduled' : 'manual', preview)
    if (!claim.claimed) return json(202, { claimed: false, reason: claim.reason ?? 'not_due' })
    if (!claim.run_id || !claim.model_id || !claim.school_year_start || !claim.school_year_end || !claim.bell_schedule_document_url || !claim.newsletter_document_url) {
      throw new HttpError(500, 'invalid_sync_claim', 'The database returned an incomplete sync claim.')
    }
    runId = claim.run_id
    const fetcher = dependencies.fetch ?? fetch
    const [bellDocument, newsletterDocument] = await Promise.all([
      fetchGoogleDocument(claim.bell_schedule_document_url, dependencies.googleDocsApiKey, fetcher),
      fetchGoogleDocument(claim.newsletter_document_url, dependencies.googleDocsApiKey, fetcher),
    ])
    if (!extractGoogleDocumentText(bellDocument)) throw new HttpError(422, 'bell_schedule_document_empty', 'The bell-schedule Google Doc is empty.')
    const sourceSection = newestWeeklyScheduleSections(extractGoogleDocumentText(newsletterDocument), dependencies.now?.() ?? new Date())
    const sourceHash = await sha256(sourceSection)
    const gemini = await invokeGeminiBellSync(claim.model_id, sourceSection, dependencies.geminiApiKey, fetcher, dependencies.timeoutMs)
    const validated = validateBellSyncExtraction(
      gemini.rawJson,
      sourceSection,
      claim.school_year_start,
      claim.school_year_end,
      easternToday(dependencies.now?.() ?? new Date()),
    )
    const result = await dependencies.finish({
      runId,
      status: preview ? 'previewed' : 'succeeded',
      sourceHash,
      sourceSection,
      rawJson: gemini.rawJson,
      validated,
      error: null,
      timingMs: Date.now() - startedAt,
    })
    return json(200, { claimed: true, preview, extraction: validated, ...result })
  } catch (caught) {
    const error = caught instanceof HttpError ? caught : new HttpError(500, 'bell_schedule_sync_failed', 'The bell-schedule detector failed safely.')
    if (runId) {
      await dependencies.finish({ runId, status: 'failed', sourceHash: null, sourceSection: null, rawJson: null, validated: [], error: error.message, timingMs: Date.now() - startedAt }).catch(() => undefined)
    }
    return json(error.status, { error: error.code, message: error.message })
  }
}
