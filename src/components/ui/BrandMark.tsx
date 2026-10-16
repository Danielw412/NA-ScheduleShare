/**
 * The NA Computer and AI Club mark, drawn on its native 6×6 grid so it stays
 * crisp at any size. The lower "CC" follows the text color, which lets the
 * mark adapt to the dark theme without a second image.
 */
export function BrandMark({ className = 'brand-mark', title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 1200" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path fill="#faaa13" fillRule="evenodd" d="M0 0H200L400 200V0H600V200L800 0H1200V600H1000V400H800V600H400L200 400V600H0Z M900 150H1000V250H800Z" />
      <path fill="currentColor" d="M200 600H600V800H300L200 900L300 1000H600V1200H200L0 1000V800Z M800 600H1200V800H900L800 900L900 1000H1200V1200H800L600 1000V800Z" />
    </svg>
  )
}
