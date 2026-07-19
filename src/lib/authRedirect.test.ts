import { describe, expect, it } from 'vitest'
import { authRedirectUrl } from './authRedirect'

describe('authRedirectUrl', () => {
  it('returns the deployed app base instead of the GitHub Pages account root', () => {
    expect(authRedirectUrl('https://danielw412.github.io', '/NA-ScheduleShare/'))
      .toBe('https://danielw412.github.io/NA-ScheduleShare/')
  })

  it('keeps local development on the same app base', () => {
    expect(authRedirectUrl('http://127.0.0.1:5173', '/NA-ScheduleShare/'))
      .toBe('http://127.0.0.1:5173/NA-ScheduleShare/')
  })
})
