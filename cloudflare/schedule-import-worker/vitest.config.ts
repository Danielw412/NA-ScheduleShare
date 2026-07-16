import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['cloudflare/schedule-import-worker/test/**/*.test.ts'],
  },
})
