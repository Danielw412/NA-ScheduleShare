import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['schedule-engine-worker/test/**/*.test.ts'],
  },
})
