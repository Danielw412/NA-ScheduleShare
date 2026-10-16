/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_ENABLE_DEMO_MODE?: string
  readonly VITE_SCHEDULE_SHARE_BASE_URL?: string
  /** Release identifier attached to error reports; CI sets it to the commit SHA. */
  readonly VITE_APP_RELEASE?: string
  /** "off" disables sending error reports to the first-party issue store. */
  readonly VITE_ISSUE_REPORTING?: string
  /** Reserved for the Sentry integration described in docs/observability.md. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
