import { describe, expect, it } from 'vitest'
import styles from '../styles.css?raw'

describe('reduced motion styles', () => {
  it('disables nonessential transforms and shortens transitions when reduced motion is requested', () => {
    const reducedMotion = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducedMotion).toContain('animation-duration: .01ms')
    expect(reducedMotion).toContain('transition-duration: .01ms')
    expect(reducedMotion).toContain('transform: none')
  })
})
