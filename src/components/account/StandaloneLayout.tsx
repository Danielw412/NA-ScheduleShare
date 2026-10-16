import type { ReactNode } from 'react'
import { brand } from '../../config/brand'
import { BrandLogo } from '../ui/BrandLogo'

/**
 * Full-height frame for screens that render outside the app shell:
 * onboarding, password recovery, suspension, and account load failures.
 * One calm centered column with the brand above it.
 */
export function StandaloneLayout({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <main className="account-standalone" aria-labelledby={labelledBy}>
      <div className="account-standalone-column">
        <header className="account-standalone-brand"><BrandLogo /></header>
        {children}
        <p className="account-standalone-footer">{brand.attribution}</p>
      </div>
    </main>
  )
}
