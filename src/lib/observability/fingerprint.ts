import type { StackFrame } from './types'

/** Remove the parts of a message that vary between occurrences of the same problem. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(["'`])(?:(?!\1).){1,120}\1/g, '<str>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** cyrb53: a small, fast, well-distributed 53-bit string hash. */
export function hashString(value: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export function topInAppFrame(frames: StackFrame[]): StackFrame | undefined {
  return frames.find((frame) => frame.in_app) ?? frames[0]
}

/**
 * Grouping key. Minified function names change with every build, so only the
 * error type, normalized message, and the (hash-free) file of the top frame
 * participate — the same bug stays one issue across deploys.
 */
export function computeFingerprint(type: string, message: string, frames: StackFrame[], route: string): string {
  const frame = topInAppFrame(frames)
  const location = frame?.filename ?? route
  return `web-${hashString(`${type}|${normalizeMessage(message)}|${location}`)}`
}
