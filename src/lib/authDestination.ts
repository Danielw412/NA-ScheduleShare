const AUTH_DESTINATION_KEY = 'scheduleshare:auth-destination'

export function safeAuthDestination(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/schedule'
  return value
}

export function rememberAuthDestination(value: string | null | undefined = '/schedule'): void {
  window.sessionStorage.setItem(AUTH_DESTINATION_KEY, safeAuthDestination(value))
}

export function pendingAuthDestination(): string {
  return safeAuthDestination(window.sessionStorage.getItem(AUTH_DESTINATION_KEY))
}

export function hasPendingAuthDestination(): boolean {
  return window.sessionStorage.getItem(AUTH_DESTINATION_KEY) !== null
}

export function clearAuthDestination(): void {
  window.sessionStorage.removeItem(AUTH_DESTINATION_KEY)
}
