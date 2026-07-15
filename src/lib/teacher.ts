const HONORIFIC_PREFIX = /^(mr|mrs|ms|miss|dr|prof|professor|coach)\.?\s+/i
const OBVIOUSLY_INVALID_CHARACTERS = /[0-9,@]/

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

export function normalizeTeacherLastName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function teacherLastNameError(value: string): string | null {
  const normalized = normalizeTeacherLastName(value)
  if (normalized.length < 2) return 'Enter the teacher’s last name.'
  if (normalized.length > 120) return 'Teacher last names must be 120 characters or fewer.'
  if (HONORIFIC_PREFIX.test(normalized)) return 'Leave out titles such as Mr., Ms., or Dr.'
  if (OBVIOUSLY_INVALID_CHARACTERS.test(normalized) || hasControlCharacter(normalized)) return 'Enter a valid teacher last name.'
  return null
}
