import { useEffect, useMemo, useState } from 'react'
import { profilePictureUrl } from '../../lib/profile'

export interface ProfileAvatarProps {
  userId: string
  fullName: string
  revision?: string | number
  className?: string
}

const failedProfilePictureUrls = new Set<string>()

function initials(fullName: string): string {
  return fullName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toLocaleUpperCase() || 'NA'
}

export function ProfileAvatar({ userId, fullName, revision, className = '' }: ProfileAvatarProps) {
  const url = useMemo(() => profilePictureUrl(userId, revision), [revision, userId])
  const [failed, setFailed] = useState(() => Boolean(url && failedProfilePictureUrls.has(url)))

  useEffect(() => setFailed(Boolean(url && failedProfilePictureUrls.has(url))), [url])

  function handleImageError() {
    if (url) failedProfilePictureUrls.add(url)
    setFailed(true)
  }

  return <span className={`avatar profile-avatar ${className}`.trim()} aria-hidden="true">
    <span>{initials(fullName)}</span>
    {url && !failed ? <img alt="" src={url} loading="lazy" decoding="async" onError={handleImageError} /> : null}
  </span>
}
