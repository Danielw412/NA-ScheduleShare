import { describe, expect, it } from 'vitest'
import { controlPanelHtml } from '../src/gui.js'

describe('Schedule Engine control panel', () => {
  it('offers queue controls and debugging without embedding credentials', () => {
    const html = controlPanelHtml()
    expect(html).toContain('Process one job')
    expect(html).toContain('Process full queue')
    expect(html).toContain('Prediction engine ready')
    expect(html).toContain('displacement limit')
    expect(html).toContain('Raw debug data')
    expect(html).not.toContain('Prediction engine not implemented')
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
