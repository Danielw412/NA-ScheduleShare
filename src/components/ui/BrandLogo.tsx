import { brand } from '../../config/brand'

export function BrandLogo({ compact = false, logoPath = brand.logoPath }: { compact?: boolean; logoPath?: string }) {
  return (
    <span className="brand-logo" aria-label={brand.siteName}>
      <img src={`${import.meta.env.BASE_URL}${logoPath}`} alt="NA Computer and AI Club logo" />
      {compact ? null : <span>{brand.siteName}</span>}
    </span>
  )
}
