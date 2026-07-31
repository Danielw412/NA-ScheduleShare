export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`The upstream response exceeded ${maximumBytes} bytes.`)
    this.name = 'ResponseBodyTooLargeError'
  }
}

export class InvalidJsonResponseError extends Error {
  constructor() {
    super('The upstream response was not valid JSON.')
    this.name = 'InvalidJsonResponseError'
  }
}

interface ReadableBody {
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export async function readBoundedBody(source: ReadableBody, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = source.headers.get('Content-Length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      await source.body?.cancel().catch(() => undefined)
      throw new ResponseBodyTooLargeError(maximumBytes)
    }
  }

  if (!source.body) return new Uint8Array()

  const reader = source.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ResponseBodyTooLargeError(maximumBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBody(response, maximumBytes))
}

export async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const text = await readBoundedText(response, maximumBytes)
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    throw new InvalidJsonResponseError()
  }
}
