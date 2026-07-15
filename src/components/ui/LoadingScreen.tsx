import { BrandLogo } from './BrandLogo'

export function LoadingScreen({ label = 'Loading NA ScheduleShare…' }: { label?: string }) {
  return (
    <main className="centered-state" aria-live="polite">
      <BrandLogo />
      <span className="loader" aria-hidden="true" />
      <p>{label}</p>
    </main>
  )
}
