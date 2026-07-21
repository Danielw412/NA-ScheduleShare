import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [{
    name: 'load-font-as-array-buffer',
    enforce: 'pre',
    async load(id) {
      const path = id.split('?')[0]
      if (!path.endsWith('.woff2')) return null
      const nodeFs = 'node:fs'
      const { readFileSync } = await import(nodeFs)
      const base64 = readFileSync(path).toString('base64')
      return `const binary = atob(${JSON.stringify(base64)});
const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
export default bytes.buffer;`
    },
  }],
  resolve: {
    alias: {
      '@cf-wasm/resvg/workerd': '@cf-wasm/resvg/node',
    },
  },
  test: {
    environment: 'node',
    include: ['cloudflare/schedule-import-worker/test/**/*.test.ts'],
  },
})
