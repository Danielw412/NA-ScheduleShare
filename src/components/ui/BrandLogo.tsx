import { brand } from '../../config/brand'

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo" aria-label={brand.siteName}>
      <img src={`${import.meta.env.BASE_URL}${brand.logoPath}`} alt="NA Computer and AI Club temporary logo" />
      {compact ? null : <span>{brand.siteName}</span>}
    </span>
  )
}
