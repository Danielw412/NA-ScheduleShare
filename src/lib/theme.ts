export type ThemePreference = 'system' | 'light' | 'dark'

const THEME_KEY = 'scheduleshare.theme'

export function storedThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

const THEME_COLORS = { light: '#ffffff', dark: '#141517' } as const

/** Browser chrome (address bar, status bar) follows the chosen theme too. */
function applyThemeColor(preference: ThemePreference) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.dataset.media ?? meta.getAttribute('media') ?? ''
    if (!meta.dataset.media) meta.dataset.media = media
    const scheme = media.includes('dark') ? 'dark' : 'light'
    if (preference === 'system') {
      meta.setAttribute('media', meta.dataset.media)
      meta.content = THEME_COLORS[scheme]
    } else {
      meta.removeAttribute('media')
      meta.content = THEME_COLORS[preference]
    }
  }
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
  applyThemeColor(preference)
}

let syncingAcrossTabs = false

export function applyStoredTheme() {
  applyTheme(storedThemePreference())
  // A change made in another tab applies here as well.
  if (!syncingAcrossTabs && typeof window !== 'undefined') {
    syncingAcrossTabs = true
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_KEY || event.key === null) applyTheme(storedThemePreference())
    })
  }
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_KEY)
    else window.localStorage.setItem(THEME_KEY, preference)
  } catch {
    // The choice still applies until the page is reloaded.
  }
  applyTheme(preference)
}
