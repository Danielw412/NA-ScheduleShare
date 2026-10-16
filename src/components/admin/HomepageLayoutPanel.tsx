import { useEffect, useState } from 'react'
import { setHomepageLayoutCache, useHomepageLayout } from '../../features/home/useHomepageLayout'
import type { HomepageLayout } from '../../lib/domain'
import { adminGetHomepageLayout, adminUpdateHomepageLayout } from '../../lib/supabase/data'
import { useToast } from '../ui/Toast'

const options: Array<{ value: HomepageLayout; title: string; description: string; thumb: 'balanced' | 'bell' }> = [
  {
    value: 'balanced',
    title: 'Balanced',
    description: 'ScheduleShare’s features lead. The live bell appears as one compact line.',
    thumb: 'balanced',
  },
  {
    value: 'bell_schedule',
    title: 'Bell schedule first',
    description: 'The current period, countdown, and the whole day’s bells fill the top of the page.',
    thumb: 'bell',
  },
]

/** Administrator control for what the homepage leads with, for every visitor. */
export function HomepageLayoutPanel({ isDemo }: { isDemo: boolean }) {
  const { showToast } = useToast()
  const [layout, setLayout] = useState<HomepageLayout>('balanced')
  const [savedLayout, setSavedLayout] = useState<HomepageLayout>('balanced')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cachedLayout = useHomepageLayout()
  // Demo mode has no server; the browser's cached layout stands in for it.
  const demoLayout = isDemo ? cachedLayout ?? 'balanced' : null

  useEffect(() => {
    if (demoLayout) {
      setLayout(demoLayout)
      setSavedLayout(demoLayout)
      setLoading(false)
      return
    }
    let active = true
    void adminGetHomepageLayout()
      .then((settings) => {
        if (!active) return
        setLayout(settings.layout)
        setSavedLayout(settings.layout)
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'The homepage layout could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [demoLayout])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (!isDemo) await adminUpdateHomepageLayout(layout)
      setSavedLayout(layout)
      setHomepageLayoutCache(layout)
      showToast(layout === 'bell_schedule' ? 'Homepage now leads with the bell schedule.' : 'Homepage now uses the balanced layout.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The homepage layout could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-section" aria-labelledby="homepage-layout-title">
      <div className="section-header">
        <div>
          <h2 id="homepage-layout-title">Homepage layout</h2>
          <p>Choose what every visitor sees first on the homepage. Changes apply immediately.</p>
        </div>
      </div>
      <fieldset disabled={loading || saving}>
        <legend className="sr-only">Homepage layout</legend>
        <div className="layout-options">
          {options.map((option) => (
            <label className="layout-option" key={option.value}>
              <span className={`layout-thumb is-${option.thumb}`} aria-hidden="true"><i /><i /><i /></span>
              <input type="radio" name="homepage-layout" value={option.value} checked={layout === option.value} onChange={() => setLayout(option.value)} />
              <span><strong>{option.title}</strong><small>{option.description}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="button button-primary" type="button" disabled={loading || saving || layout === savedLayout} onClick={() => void save()}>{saving ? 'Saving…' : 'Save homepage layout'}</button>
        {layout !== savedLayout ? <span className="field-help">Not saved yet.</span> : null}
      </div>
    </section>
  )
}
