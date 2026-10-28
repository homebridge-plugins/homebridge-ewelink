import { describe, expect, it, vi } from 'vitest'

/**
 * Telling the cloud's stored copy of a device apart from what the device
 * itself pushes.
 *
 * A status query is answered from the stored copy, which can be stale - it gave
 * two open zbu-curt-7006 curtains a position of closed (#810). So a reply is
 * flagged, and a handler can decide whether to trust it.
 */

const listeners = {}
vi.mock('websocket-as-promised', () => ({
  default: class {
    constructor() {
      [
        'onOpen',
        'onUnpackedMessage',
        'onClose',
        'onError',
      ].forEach((event) => {
        this[event] = {
          addListener: (f) => { listeners[event] = f },
        }
      })
    }

    async open() {}

    async close() {}

    removeAllListeners() {}
  },
}))
vi.mock('axios', () => ({
  default: async () => ({
    data: { domain: 'eu-pconnect.test' },
  }),
}))

const { default: WSClient } = await import('../lib/connection/ws.js')

/** Connects a client, and returns every update it reports to the platform. */
async function connect() {
  const log = Object.assign(() => {}, {
    debug: () => {},
    debugWarn: () => {},
    warn: () => {},
  })
  const client = new WSClient({ config: {}, lang: {}, log }, { httpHost: 'eu-apia.test' })
  const received = []
  client.receiveUpdate(update => received.push(update))
  await client.login()
  return received
}

const PARAMS = { curPercent: 100, openPercent: 0 }

describe('a web socket message about a device', () => {
  it('is flagged as the stored state when it is the reply to a status query', async () => {
    const received = await connect()

    listeners.onUnpackedMessage({
      error: 0,
      deviceid: 'abc',
      sequence: '1',
      params: { ...PARAMS },
    })

    expect(received.at(-1).params).toMatchObject({ ...PARAMS, updateSource: 'WS', storedState: true })
  })

  it('is not flagged when the device pushed it', async () => {
    const received = await connect()

    listeners.onUnpackedMessage({
      action: 'update',
      deviceid: 'abc',
      params: { ...PARAMS },
    })

    expect(received.at(-1).params).toMatchObject({ ...PARAMS, updateSource: 'WS' })
    expect(received.at(-1).params).not.toHaveProperty('storedState')
  })
})
