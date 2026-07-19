export function authRedirectUrl(
  currentUrl = window.location.href,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const redirectUrl = new URL(baseUrl, currentUrl)
  redirectUrl.hash = ''
  redirectUrl.search = ''
  return redirectUrl.toString()
}
