import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyStoredTheme, setThemePreference, storedThemePreference } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)">'
})

afterEach(() => {
  document.head.innerHTML = ''
})

function themeColors() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => [meta.content, meta.getAttribute('media')])
}

describe('theme preference', () => {
  it('applies a chosen theme to the page and the browser chrome', () => {
    setThemePreference('dark')
    expect(storedThemePreference()).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(themeColors()).toEqual([['#141517', null], ['#141517', null]])
  })

  it('returns to the system setting', () => {
    setThemePreference('light')
    setThemePreference('system')
    expect(localStorage.getItem('scheduleshare.theme')).toBeNull()
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(themeColors()).toEqual([['#ffffff', '(prefers-color-scheme: light)'], ['#141517', '(prefers-color-scheme: dark)']])
  })

  it('follows a change made in another tab', () => {
    applyStoredTheme()
    localStorage.setItem('scheduleshare.theme', 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: 'scheduleshare.theme', newValue: 'dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
