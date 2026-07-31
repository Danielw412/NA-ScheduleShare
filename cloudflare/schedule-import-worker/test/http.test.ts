import { describe, expect, it } from 'vitest'
import {
  InvalidJsonResponseError,
  ResponseBodyTooLargeError,
  readBoundedJson,
  readBoundedText,
} from '../src/http'

describe('bounded upstream response readers', () => {
  it('stops a streamed response that exceeds the byte limit without a Content-Length header', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.enqueue(new Uint8Array([5, 6, 7, 8]))
        controller.close()
      },
    }))

    await expect(readBoundedText(response, 6)).rejects.toBeInstanceOf(ResponseBodyTooLargeError)
  })

  it('distinguishes malformed JSON from transport and size failures', async () => {
    await expect(readBoundedJson(new Response('not-json'), 64)).rejects.toBeInstanceOf(InvalidJsonResponseError)
  })
})
