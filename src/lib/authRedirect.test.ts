import { describe, expect, it } from 'vitest'
import { authRedirectUrl } from './authRedirect'

describe('authRedirectUrl', () => {
  it('keeps the legacy GitHub Pages project path during the transition', () => {
    expect(authRedirectUrl('https://danielw412.github.io/NA-ScheduleShare/#/classes', './'))
      .toBe('https://danielw412.github.io/NA-ScheduleShare/')
  })

  it('uses the root of the custom production domain', () => {
    expect(authRedirectUrl('https://schedule.naclubs.net/#/classes', './'))
      .toBe('https://schedule.naclubs.net/')
  })

  it('keeps local development on the active app path', () => {
    expect(authRedirectUrl('http://127.0.0.1:5173/#/schedule', './'))
      .toBe('http://127.0.0.1:5173/')
  })
})
