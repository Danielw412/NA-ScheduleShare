import { describe, expect, it } from 'vitest'
import { createDevelopmentPlaceholder, createPredictionFunction, developmentPlaceholderAllowed, PredictionEngineNotImplementedError } from '../src/prediction-engine.js'
import { workerInput } from './fixtures.js'

describe('placeholder prediction boundary', () => {
  it('allows placeholders only for explicit non-production local Supabase development', () => {
    expect(developmentPlaceholderAllowed('http://127.0.0.1:54321', 'true', 'development')).toBe(true)
    expect(developmentPlaceholderAllowed('https://project.supabase.co', 'true', 'development')).toBe(false)
    expect(developmentPlaceholderAllowed('http://localhost:54321', 'true', 'production')).toBe(false)
    expect(developmentPlaceholderAllowed('http://localhost:54321', 'false', 'test')).toBe(false)
  })

  it('marks local placeholder output and preserves the original meeting slots', () => {
    const result = createDevelopmentPlaceholder(workerInput)
    expect(result.development_placeholder).toBe(true)
    expect(result.schedule[0]).toMatchObject({
      course_id: 'course-2',
      course_name: 'Literature',
      changed_from_enrollment_id: 'enrollment-1',
      meeting_slots: workerInput.current_schedule[0].meeting_slots,
    })
  })

  it('does not return fake predictions when the placeholder is disabled', async () => {
    const predict = createPredictionFunction({ allowDevelopmentPlaceholder: false })
    await expect(predict(workerInput)).rejects.toBeInstanceOf(PredictionEngineNotImplementedError)
  })
})
