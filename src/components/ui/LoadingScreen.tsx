import { BrandMark } from './BrandMark'

/**
 * Full-height loading state. Pages render it inside the shell's <main>, so it
 * is a status region rather than a landmark of its own.
 */
export function LoadingScreen({ label = 'Loading NA ScheduleShare…', fullscreen = false }: { label?: string; fullscreen?: boolean }) {
  return (
    <div className={fullscreen ? 'centered-state' : 'route-loading'} role="status" aria-live="polite">
      {fullscreen ? <BrandMark /> : null}
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}
