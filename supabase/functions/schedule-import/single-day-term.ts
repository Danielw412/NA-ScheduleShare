type DayType = 'A' | 'B'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function isUnknownTerm(value: string): boolean {
  const normalized = collapseWhitespace(value).toLowerCase().replace(/[._]/g, ' ')
  return normalized === ''
    || normalized === 'unknown'
    || normalized === 'not visible'
    || normalized === 'n/a'
}

function slotDayTypes(value: string): DayType[] | null {
  const normalized = collapseWhitespace(value).toUpperCase()
  const powerSchool = normalized.match(/^P?0?([1-9])\s*\(\s*(A\s*[-/]\s*B|A|B)\s*\)$/)
  if (powerSchool) {
    return powerSchool[2].replace(/\s/g, '').length > 1
      ? ['A', 'B']
      : [powerSchool[2].trim() as DayType]
  }

  const dayFirst = normalized.match(/^([AB])(?:\s+DAY)?(?:\s+P(?:ERIOD)?)?\s*0?([1-9])$/)
  if (dayFirst) return [dayFirst[1] as DayType]

  const periodFirst = normalized.match(/^(?:P(?:ERIOD)?\s*)?0?([1-9])\s*\(?\s*([AB])\s*\)?$/)
  if (periodFirst) return [periodFirst[2] as DayType]

  return null
}

function meetsOnOnlyOneDayType(slots: unknown): boolean {
  if (!Array.isArray(slots) || slots.length === 0 || !slots.every((slot) => typeof slot === 'string')) return false

  const dayTypes: DayType[] = []
  for (const slot of slots) {
    const parsed = slotDayTypes(slot)
    if (!parsed) return false
    dayTypes.push(...parsed)
  }

  return new Set(dayTypes).size === 1
}

/**
 * Applies a deterministic rule after Gemini returns its structured schedule:
 * an unknown term becomes FY when every meeting slot is exclusively A-day or
 * exclusively B-day. Explicit FY/S1/S2 values are never changed.
 */
export function defaultUnknownSingleDayTerms(rawOutput: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawOutput.trim())
  } catch {
    return rawOutput
  }

  if (!isRecord(parsed) || parsed.schedule !== true || !Array.isArray(parsed.rows)) return rawOutput

  let changed = false
  for (const candidate of parsed.rows) {
    if (!isRecord(candidate)
      || typeof candidate.term !== 'string'
      || !isUnknownTerm(candidate.term)
      || !meetsOnOnlyOneDayType(candidate.slots)) {
      continue
    }

    candidate.term = 'FY'
    changed = true
  }

  return changed ? JSON.stringify(parsed) : rawOutput
}
