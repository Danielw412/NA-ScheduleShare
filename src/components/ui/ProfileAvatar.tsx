import { useEffect, useMemo, useState } from 'react'
import { profilePictureUrl } from '../../lib/profile'

export interface ProfileAvatarProps {
  userId: string
  fullName: string
  revision?: string | number
  className?: string
}

function initials(fullName: string): string {
  return fullName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toLocaleUpperCase() || 'NA'
}

export function ProfileAvatar({ userId, fullName, revision, className = '' }: ProfileAvatarProps) {
  const url = useMemo(() => profilePictureUrl(userId, revision), [revision, userId])
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [url])

  return <span className={`avatar profile-avatar ${className}`.trim()} aria-hidden="true">
    <span>{initials(fullName)}</span>
    {url && !failed ? <img alt="" src={url} onError={() => setFailed(true)} /> : null}
  </span>
}
