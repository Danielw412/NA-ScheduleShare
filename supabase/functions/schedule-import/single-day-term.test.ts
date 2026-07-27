import { describe, expect, it } from 'vitest'
import { defaultUnknownSingleDayTerms } from './single-day-term'

function rewrite(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const output = defaultUnknownSingleDayTerms(JSON.stringify({ schedule: true, issue: '', rows }))
  return (JSON.parse(output) as { rows: Array<Record<string, unknown>> }).rows
}

describe('defaultUnknownSingleDayTerms', () => {
  it('sets unknown A-only and B-only classes to full year', () => {
    expect(rewrite([
      { course: 'Study Hall - NASH', teacher: 'N/A', term: 'unknown', slots: ['A8'] },
      { course: 'Gym', teacher: 'Winters', term: '', slots: ['P02(B)'] },
    ])).toEqual([
      { course: 'Study Hall - NASH', teacher: 'N/A', term: 'FY', slots: ['A8'] },
      { course: 'Gym', teacher: 'Winters', term: 'FY', slots: ['P02(B)'] },
    ])
  })

  it('supports multiple periods as long as every slot is on the same day type', () => {
    expect(rewrite([
      { course: 'Lab', teacher: 'Teacher', term: 'not visible', slots: ['A Day Period 3', 'A4'] },
    ])).toEqual([
      { course: 'Lab', teacher: 'Teacher', term: 'FY', slots: ['A Day Period 3', 'A4'] },
    ])
  })

  it('keeps unknown terms when a class meets on both A and B days', () => {
    const rows = [{ course: 'Business Communications', teacher: 'Sestili', term: 'unknown', slots: ['P05(A-B)'] }]
    expect(rewrite(rows)).toEqual(rows)
  })

  it('never overrides an explicit semester term', () => {
    const rows = [{ course: 'Explicit Semester Class', teacher: 'Teacher', term: 'S1', slots: ['B6'] }]
    expect(rewrite(rows)).toEqual(rows)
  })

  it('leaves malformed output untouched', () => {
    expect(defaultUnknownSingleDayTerms('not-json')).toBe('not-json')
  })
})
