import type { Transport } from '../types'

/** Development transport: prints each captured event once, collapsed. */
export const consoleTransport: Transport = {
  name: 'console',
  send(event, hint) {
    console.groupCollapsed(`%c${event.level}%c ${event.message}`, 'font-weight:700', 'font-weight:400')
    console.log('event', event)
    if (hint.originalException) console.log('original', hint.originalException)
    console.groupEnd()
  },
}
