import type { StackFrame } from './types'

const CHROME_FRAME = /^\s*at (?:(.+?) \()?((?:https?|blob|file|chrome-extension|moz-extension|safari-extension|webpack|vite)?:?[^\s()]*?):(\d+):(\d+)\)?\s*$/
const GECKO_FRAME = /^\s*(.*?)@(.*?):(\d+):(\d+)\s*$/
const MAX_FRAMES = 30

/** Build output adds content hashes to chunk names; drop them so grouping survives deploys. */
export function normalizeFilename(filename: string): string {
  let path = filename
  try {
    const url = new URL(filename)
    path = url.pathname
  } catch {
    // Not a URL; keep as is.
  }
  return path
    .replace(/^\/+/, '')
    .replace(/-[A-Za-z0-9_]{6,12}(\.m?js)$/, '$1')
    .replace(/\?.*$/, '')
}

export function isExtensionFrame(filename: string | undefined): boolean {
  return Boolean(filename && /^(chrome|moz|safari(-web)?)-extension:/.test(filename))
}

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return []
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    const match = CHROME_FRAME.exec(line) ?? GECKO_FRAME.exec(line)
    if (!match) continue
    const [, fn, file, lineNumber, column] = match
    const filename = file || undefined
    frames.push({
      function: fn?.trim() || undefined,
      filename: filename && !isExtensionFrame(filename) ? normalizeFilename(filename) : filename,
      lineno: Number(lineNumber),
      colno: Number(column),
      in_app: Boolean(filename) && !isExtensionFrame(filename) && !/node_modules|\/@vite\/|\/deps\//.test(filename ?? ''),
    })
    if (frames.length >= MAX_FRAMES) break
  }
  return frames
}
