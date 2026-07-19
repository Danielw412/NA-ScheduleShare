export function authRedirectUrl(
  origin = window.location.origin,
  baseUrl = import.meta.env.BASE_URL,
): string {
  return new URL(baseUrl, origin).toString()
}
