import { describe, expect, it } from 'vitest'
import { normalizeTeacherLastName, teacherLastNameError } from './teacher'

describe('teacher last-name input', () => {
  it('trims and collapses extra whitespace', () => {
    expect(normalizeTeacherLastName('  De   la Cruz  ')).toBe('De la Cruz')
  })

  it('rejects titles and obvious full-name formatting', () => {
    expect(teacherLastNameError('Dr. Smith')).toContain('titles')
    expect(teacherLastNameError('Smith, Joe')).toContain('valid')
    expect(teacherLastNameError('Smith2')).toContain('valid')
  })

  it('allows legitimate compound, hyphenated, and apostrophe last names', () => {
    expect(teacherLastNameError('De la Cruz')).toBeNull()
    expect(teacherLastNameError('Smith-Jones')).toBeNull()
    expect(teacherLastNameError("O'Connor")).toBeNull()
  })
})
