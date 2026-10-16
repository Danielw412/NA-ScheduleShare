import { createScheduleShareUrl, scheduleShareTitle } from '../../lib/scheduleShare'

export function isMobileShareDevice(): boolean {
  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  if (typeof navigatorWithUserAgentData.userAgentData?.mobile === 'boolean') return navigatorWithUserAgentData.userAgentData.mobile
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isAbort(caught: unknown): boolean {
  return (caught instanceof DOMException || caught instanceof Error) && caught.name === 'AbortError'
}

/**
 * Creates (or reuses) the student's share link, then opens the native share
 * sheet on phones and copies the link elsewhere. Throws with a readable
 * message when the link cannot be created or copied.
 */
export async function shareScheduleLink(): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = await createScheduleShareUrl()
  if (isMobileShareDevice() && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: scheduleShareTitle, url })
      return 'shared'
    } catch (caught) {
      if (isAbort(caught)) return 'cancelled'
      throw caught
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
