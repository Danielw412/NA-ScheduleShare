import { brand } from '../../config/brand'
import { BrandMark } from './BrandMark'

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo" aria-label={brand.siteName} role="img">
      <BrandMark />
      {compact ? null : <span className="brand-wordmark" aria-hidden="true"><span>NA</span> ScheduleShare</span>}
    </span>
  )
}
