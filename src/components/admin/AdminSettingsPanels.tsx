import { AlertCircle, BrainCircuit, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AdminClubPromptSettings, GeminiThinkingLevel, HomepageActivityScope, HomepageStatisticKey, HomepageStatisticSettings, ScheduleImportDiagnosticLog, ScheduleImportModelRecord } from '../../lib/domain'
import { adminDeleteScheduleImportDiagnostic, adminGetClubPromptSettings, adminGetHomepageStatisticSettings, adminListScheduleImportDiagnostics, adminListScheduleImportModels, adminUpdateClubPromptSettings, adminUpdateHomepageStatisticSettings, adminUpdateScheduleImportProgressDuration, adminUpdateScheduleImportRetrySetting, adminUpdateScheduleImportSettings, getHomepageStatistic, getScheduleImportUiSettings } from '../../lib/supabase/data'
import { useClubPrompt } from '../club/ClubPromptProvider'
import { useToast } from '../ui/Toast'
import { useAdminDialogs } from './AdminDialogs'
import { AdminSectionHeading } from './AdminSectionHeading'
import { formatTimestamp, IdText, sentenceCase, TableSkeleton } from './adminShared'

/* ---------- Homepage settings ---------- */

const defaultHomepageSettings: HomepageStatisticSettings = {
  shown: false,
  statistic_key: 'students_joined',
  minimum_value: 25,
  activity_scope: 'total',
  updated_at: '',
}

const homepageStatisticLabels: Record<HomepageStatisticKey, string> = {
  students_joined: 'NA students joined',
  schedules_uploaded: 'Schedules uploaded',
  class_connections: 'Class connections found',
}

export function HomepageStatisticPanel({ isDemo }: { isDemo: boolean }) {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<HomepageStatisticSettings>(defaultHomepageSettings)
  const [realValue, setRealValue] = useState<{ value: number; label: string } | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isDemo) return
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, statistic] = await Promise.all([
        adminGetHomepageStatisticSettings(),
        getHomepageStatistic(),
      ])
      setSettings(nextSettings)
      setRealValue(statistic ? { value: statistic.statistic_value, label: statistic.statistic_label } : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load homepage statistic settings.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateHomepageStatisticSettings({
        shown: settings.shown,
        statistic_key: settings.statistic_key,
        minimum_value: settings.minimum_value,
        activity_scope: settings.activity_scope,
      })
      showToast('Homepage statistic settings saved. The displayed number remains database-calculated.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save homepage statistic settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-section" aria-labelledby="admin-statistic-title">
      <AdminSectionHeading
        id="admin-statistic-title"
        title="Homepage statistic"
        description="Choose which real number appears on the homepage for signed-out visitors, and when. It’s always calculated from the database and can’t be typed in."
      />
      {loading ? <TableSkeleton label="Loading homepage statistic settings" /> : <form className="admin-form" onSubmit={(event) => void save(event)}>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.shown} onChange={(event) => setSettings((current) => ({ ...current, shown: event.target.checked }))} />
          <span><strong>Show homepage statistic</strong><small>It stays hidden while the real value is below the minimum.</small></span>
        </label>
        <div className="admin-field-grid">
          <div className="field">
            <label htmlFor="admin-statistic-key">Statistic</label>
            <select id="admin-statistic-key" value={settings.statistic_key} onChange={(event) => setSettings((current) => ({ ...current, statistic_key: event.target.value as HomepageStatisticKey }))}>
              {(Object.entries(homepageStatisticLabels) as Array<[HomepageStatisticKey, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="admin-statistic-minimum">Minimum real value</label>
            <input id="admin-statistic-minimum" min={0} max={1000000000} step={1} type="number" inputMode="numeric" value={settings.minimum_value} onChange={(event) => setSettings((current) => ({ ...current, minimum_value: Math.max(0, Number(event.target.value)) }))} />
          </div>
          <div className="field">
            <label htmlFor="admin-statistic-scope">Activity window</label>
            <select id="admin-statistic-scope" value={settings.activity_scope} onChange={(event) => setSettings((current) => ({ ...current, activity_scope: event.target.value as HomepageActivityScope }))}>
              <option value="total">Total activity</option>
              <option value="recent">Recent activity (last 30 days)</option>
            </select>
          </div>
        </div>
        <div className="admin-readout">
          <span>Visitors see right now</span>
          {realValue ? <strong className="numeric">{`${new Intl.NumberFormat().format(realValue.value)} ${realValue.label}`}</strong> : <strong>Nothing. The statistic is turned off or below the minimum.</strong>}
        </div>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <div className="form-actions">
          <button className="button button-primary" disabled={saving || isDemo}>{saving ? 'Saving…' : 'Save homepage settings'}</button>
          {isDemo ? <span className="field-help">Connect Supabase to save or preview real statistics.</span> : null}
        </div>
      </form>}
    </section>
  )
}

const defaultClubPromptSettings: AdminClubPromptSettings = { enabled: true, delay_seconds: 180, why_scheduleshare_enabled: true, updated_at: '' }

export function ClubPromptPanel({ isDemo }: { isDemo: boolean }) {
  const { setWhyScheduleShareEnabled } = useClubPrompt()
  const { showToast } = useToast()
  const [settings, setSettings] = useState<AdminClubPromptSettings>(defaultClubPromptSettings)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const delayInvalid = settings.delay_seconds < 30 || settings.delay_seconds > 3600

  const load = useCallback(async () => {
    if (isDemo) return
    setLoading(true)
    setError(null)
    try {
      setSettings(await adminGetClubPromptSettings())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load club invitation settings.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (settings.delay_seconds < 30 || settings.delay_seconds > 3600) {
      setError('The delay must be between 30 seconds and 60 minutes.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateClubPromptSettings({
        enabled: settings.enabled,
        delay_seconds: settings.delay_seconds,
        why_scheduleshare_enabled: settings.why_scheduleshare_enabled,
      })
      setWhyScheduleShareEnabled(settings.why_scheduleshare_enabled)
      showToast('Club invitation and page visibility settings saved.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save club invitation settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-section" aria-labelledby="admin-club-title">
      <AdminSectionHeading
        id="admin-club-title"
        title="Club invitation"
        description="The “built by the NA Computer and AI Club” popup. Each student sees it once, only after they sign in, add a schedule, visit three pages, and stay for the delay below. The footer link and homepage button are always there."
      />
      {loading ? <TableSkeleton label="Loading club invitation settings" /> : <form className="admin-form" onSubmit={(event) => void save(event)}>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />
          <span><strong>Show the timed invitation</strong><small>Turning this off hides the popup for everyone without touching the footer link.</small></span>
        </label>
        <div className="field admin-field-short">
          <label htmlFor="admin-club-delay">Delay before it appears (seconds)</label>
          <input id="admin-club-delay" min={30} max={3600} step={10} type="number" inputMode="numeric" disabled={!settings.enabled} aria-invalid={delayInvalid || undefined} aria-describedby="admin-club-delay-help" value={settings.delay_seconds} onChange={(event) => setSettings((current) => ({ ...current, delay_seconds: Math.round(Number(event.target.value)) }))} />
          <p className="field-help" id="admin-club-delay-help">{formatDelaySummary(settings.delay_seconds)} of active time on the site. Time in a background tab doesn’t count.</p>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.why_scheduleshare_enabled} onChange={(event) => setSettings((current) => ({ ...current, why_scheduleshare_enabled: event.target.checked }))} />
          <span><strong>Show the Why ScheduleShare page</strong><small>Turning this off removes every link to the page and blocks direct visits for all users.</small></span>
        </label>
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        <div className="form-actions">
          <button className="button button-primary" disabled={saving || isDemo}>{saving ? 'Saving…' : 'Save invitation settings'}</button>
          {isDemo ? <span className="field-help">Connect Supabase to save club invitation settings.</span> : null}
        </div>
      </form>}
    </section>
  )
}

function formatDelaySummary(delaySeconds: number): string {
  if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) return 'No delay'
  if (delaySeconds < 60) return `${Math.round(delaySeconds)} seconds`
  const minutes = delaySeconds / 60
  const rounded = Math.round(minutes * 10) / 10
  return `${rounded} minute${rounded === 1 ? '' : 's'}`
}

/* ---------- AI importer ---------- */

const demoImportModels: ScheduleImportModelRecord[] = [
  {
    model_id: 'gemini-3.5-flash-lite',
    display_name: 'Gemini 3.5 Flash-Lite',
    enabled: true,
    supports_image_input: true,
    supports_structured_output: true,
    supported_thinking_levels: ['minimal', 'low', 'medium', 'high'],
    max_output_tokens: 65536,
    is_active: true,
    production_thinking_level: 'low',
    production_output_token_limit: 4096,
  },
  {
    model_id: 'gemini-3.5-flash',
    display_name: 'Gemini 3.5 Flash',
    enabled: true,
    supports_image_input: true,
    supports_structured_output: true,
    supported_thinking_levels: ['minimal', 'low', 'medium', 'high'],
    max_output_tokens: 65536,
    is_active: false,
    production_thinking_level: 'low',
    production_output_token_limit: 4096,
  },
]

const diagnosticStatus: Record<ScheduleImportDiagnosticLog['status'], { label: string; badge: string }> = {
  success: { label: 'Succeeded', badge: 'badge badge-success' },
  validation_error: { label: 'Validation error', badge: 'badge badge-danger' },
  provider_error: { label: 'Provider error', badge: 'badge badge-danger' },
}

export function AiImporterManagementPanel({ isDemo }: { isDemo: boolean }) {
  const { showToast } = useToast()
  const dialogs = useAdminDialogs()
  const [models, setModels] = useState<ScheduleImportModelRecord[]>(isDemo ? demoImportModels : [])
  const [logs, setLogs] = useState<ScheduleImportDiagnosticLog[]>([])
  const [modelId, setModelId] = useState(isDemo ? demoImportModels[0].model_id : '')
  const [thinkingLevel, setThinkingLevel] = useState<GeminiThinkingLevel>('low')
  const [outputTokenLimit, setOutputTokenLimit] = useState(4096)
  const [progressDurationSeconds, setProgressDurationSeconds] = useState(6.5)
  const [retryIncompleteResults, setRetryIncompleteResults] = useState(true)
  const [loading, setLoading] = useState(!isDemo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isDemo) return
    setLoading(true)
    setError(null)
    try {
      const [nextModels, nextLogs, uiSettings] = await Promise.all([
        adminListScheduleImportModels(),
        adminListScheduleImportDiagnostics(),
        getScheduleImportUiSettings(),
      ])
      setModels(nextModels)
      setLogs(nextLogs)
      const active = nextModels.find((model) => model.is_active) ?? nextModels[0]
      setModelId(active?.model_id ?? '')
      setThinkingLevel(active?.production_thinking_level ?? 'low')
      setOutputTokenLimit(active?.production_output_token_limit ?? 4096)
      setProgressDurationSeconds(uiSettings.progress_bar_duration_ms / 1000)
      setRetryIncompleteResults(uiSettings.retry_incomplete_results)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load AI importer settings.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const selectedModel = models.find((model) => model.model_id === modelId) ?? null
  const maxTokens = Math.min(8192, selectedModel?.max_output_tokens ?? 8192)
  const canSave = selectedModel !== null
    && selectedModel.enabled
    && selectedModel.supports_image_input
    && selectedModel.supports_structured_output
    && selectedModel.supported_thinking_levels.includes(thinkingLevel)
    && Number.isInteger(outputTokenLimit)
    && outputTokenLimit >= 256
    && outputTokenLimit <= Math.min(8192, selectedModel.max_output_tokens)
    && Number.isFinite(progressDurationSeconds)
    && progressDurationSeconds >= 1
    && progressDurationSeconds <= 30

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (!isDemo) await Promise.all([
        adminUpdateScheduleImportSettings({ modelId, thinkingLevel, outputTokenLimit }),
        adminUpdateScheduleImportProgressDuration(Math.round(progressDurationSeconds * 1000)),
        adminUpdateScheduleImportRetrySetting(retryIncompleteResults),
      ])
      showToast('Production Gemini settings updated. New imports will use them immediately.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the AI importer settings.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteLog(log: ScheduleImportDiagnosticLog) {
    const confirmed = await dialogs.confirm({
      title: 'Delete this diagnostic log?',
      message: 'It’s removed now instead of when it expires. The deletion is recorded in the audit log.',
      confirmLabel: 'Delete log',
      tone: 'danger',
    })
    if (!confirmed) return
    setError(null)
    try {
      if (!isDemo) await adminDeleteScheduleImportDiagnostic(log.diagnostic_id)
      setLogs((current) => current.filter((candidate) => candidate.diagnostic_id !== log.diagnostic_id))
      showToast('Diagnostic log deleted and the access was audited.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the diagnostic log.')
    }
  }

  return (
    <div className="admin-stack">
      <section className="admin-section" aria-labelledby="admin-ai-title">
        <AdminSectionHeading
          id="admin-ai-title"
          title="Screenshot importer"
          description="The Gemini model that reads schedule screenshots. Only allowlisted models that accept images and return structured output can be chosen. Changes apply to the next import, with no redeploy."
          actions={<button className="button button-secondary button-sm" disabled={loading} type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh</button>}
        />
        {error ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{error}</p> : null}
        {loading ? <TableSkeleton label="Loading AI importer settings" /> : <form className="admin-form" onSubmit={saveSettings}>
          <div className="admin-field-grid is-two">
            <div className="field">
              <label htmlFor="admin-ai-model">Production model</label>
              <select id="admin-ai-model" value={modelId} disabled={loading || saving} onChange={(event) => {
                const model = models.find((candidate) => candidate.model_id === event.target.value)
                setModelId(event.target.value)
                if (model && !model.supported_thinking_levels.includes(thinkingLevel)) {
                  setThinkingLevel(model.supported_thinking_levels.includes('low') ? 'low' : model.supported_thinking_levels[0] ?? 'low')
                }
              }}>{models.map((model) => <option key={model.model_id} value={model.model_id} disabled={!model.enabled || !model.supports_image_input || !model.supports_structured_output}>{model.display_name}{model.enabled ? '' : ' (disabled)'}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="admin-ai-thinking">Thinking level</label>
              <select id="admin-ai-thinking" value={thinkingLevel} disabled={!selectedModel || saving} onChange={(event) => setThinkingLevel(event.target.value as GeminiThinkingLevel)}>{(selectedModel?.supported_thinking_levels ?? []).map((level) => <option key={level} value={level}>{sentenceCase(level)}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="admin-ai-tokens">Output-token limit</label>
              <input id="admin-ai-tokens" type="number" inputMode="numeric" min={256} max={maxTokens} step={128} value={outputTokenLimit} disabled={saving} aria-describedby="admin-ai-tokens-help" onChange={(event) => setOutputTokenLimit(Number(event.target.value))} />
              <p className="field-help" id="admin-ai-tokens-help">Between 256 and {maxTokens.toLocaleString()}.</p>
            </div>
            <div className="field">
              <label htmlFor="admin-ai-progress">Progress duration (seconds)</label>
              <input id="admin-ai-progress" type="number" inputMode="decimal" min={1} max={30} step={0.5} value={progressDurationSeconds} disabled={saving} aria-describedby="admin-ai-progress-help" onChange={(event) => setProgressDurationSeconds(Number(event.target.value))} />
              <p className="field-help" id="admin-ai-progress-help">How long the progress bar takes to fill, from 1 to 30 seconds.</p>
            </div>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={retryIncompleteResults} disabled={saving} onChange={(event) => setRetryIncompleteResults(event.target.checked)} />
            <span><strong>Run Gemini a second time when needed</strong><small>When the first pass has conflicts or incomplete details, Gemini rechecks the screenshots once before showing clarification items.</small></span>
          </label>
          <div className="form-actions">
            <button className="button button-primary" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save importer settings'}</button>
          </div>
        </form>}
        <div className="notice notice-info">
          <BrainCircuit aria-hidden="true" />
          <p><strong>Developer mode is off by default.</strong> An administrator turns it on inside the screenshot importer, for that dialog only. It skips ScheduleShare’s own rate limit and nothing else: sign-in, file checks, the model allowlist, and Gemini quotas still apply.</p>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="admin-ai-logs-title">
        <AdminSectionHeading
          id="admin-ai-logs-title"
          title="Diagnostic logs"
          count={logs.length.toLocaleString()}
          description="Detailed logs are kept only for imports run in developer mode and expire within 24 hours. Viewing and deleting them is audited."
        />
        {logs.length === 0
          ? <p className="empty-inline">No diagnostic logs right now.</p>
          : <ul className="list admin-disclosure-list">
            {logs.map((log) => (
              <li key={log.diagnostic_id}>
                <details className="admin-disclosure">
                  <summary>
                    <span className={diagnosticStatus[log.status].badge}>{diagnosticStatus[log.status].label}</span>
                    <span className="admin-disclosure-title">
                      <strong>{log.model_id}</strong>
                      <span className="chip-list">
                        <span className="chip">{sentenceCase(log.thinking_level)} thinking</span>
                        <span className="chip">{log.timing_ms.toLocaleString()} ms</span>
                      </span>
                    </span>
                    <span className="admin-disclosure-meta">Expires {formatTimestamp(log.expires_at)}</span>
                  </summary>
                  <div className="admin-disclosure-body">
                    <dl className="facts admin-facts">
                      <dt>Output-token limit</dt><dd className="numeric">{log.output_token_limit.toLocaleString()}</dd>
                      <dt>Created</dt><dd>{formatTimestamp(log.created_at)}</dd>
                      <dt>Log ID</dt><dd><IdText value={log.diagnostic_id} /></dd>
                    </dl>
                    {[['Exact prompt', log.prompt], ['Raw Gemini output', log.raw_output], ['Parsed output', log.parsed_output], ['Validation errors', log.validation_errors], ['Image metadata', log.image_metadata], ['Provider error details', log.provider_error]].map(([label, value]) => (
                      <section className="admin-code-block" key={String(label)}>
                        <h4>{String(label)}</h4>
                        <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null'}</pre>
                      </section>
                    ))}
                    <div className="form-actions">
                      <button className="button button-secondary button-sm button-danger-outline" type="button" onClick={() => void deleteLog(log)}><Trash2 aria-hidden="true" />Delete log</button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>}
      </section>
      {dialogs.dialog}
    </div>
  )
}
