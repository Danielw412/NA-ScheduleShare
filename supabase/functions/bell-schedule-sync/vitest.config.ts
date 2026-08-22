import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/functions/bell-schedule-sync/**/*.test.ts'],
  },
})
