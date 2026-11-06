import { Buffer } from 'node:buffer'
import { createDecipheriv, createHash } from 'node:crypto'

import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import lanClient from '../lib/connection/lan.js'
import platformLang from '../lib/utils/lang-en.js'

vi.mock('axios', () => ({
  default: vi.fn(),
}))

/**
 * A HomeKit scene writes every channel it touches at once. Each channel of a
 * multi-channel switch used to become its own LAN request, all sent together, and
 * the device's web server answers one request at a time - so the later ones
 * missed the timeout, fell back to the cloud and the scene showed as failed.
 */

const LAN_KEY = 'test-lan-key'

function makeClient() {
  const client = new lanClient({
    ipOverride: {},
    lang: platformLang,
    log: Object.assign(() => {}, {
      debug: () => {},
      warn: () => {},
    }),
    config: { mode: 'auto' },
  })
  for (const [id, uiid, productModel] of [
    ['1002792425', 162, 'T6-3C-120M'],
    ['1002793b3b', 161, 'T6-2C-120M'],
    ['10000ifan1', 34, 'iFan03'],
  ]) {
    client.deviceMap.set(id, {
      ip: `192.0.2.${client.deviceMap.size + 1}`,
      lanKey: LAN_KEY,
      uiid,
      productModel,
    })
  }
  return client
}

// What the device would read out of a request, decrypted the way it would be
function sentParams(call) {
  const { data } = call[0]
  const key = createHash('md5').update(Buffer.from(LAN_KEY, 'utf8')).digest()
  const dec = createDecipheriv('aes-128-cbc', key, Buffer.from(data.iv, 'base64'))
  return JSON.parse(Buffer.concat([
    dec.update(data.data, 'base64'),
    dec.final(),
  ]).toString())
}

function channel(deviceid, outlet, value) {
  return {
    deviceid,
    params: {
      switches: [
        { switch: value, outlet },
      ],
    },
  }
}

describe('lan requests during a scene', () => {
  beforeEach(() => {
    axios.mockReset()
    axios.mockResolvedValue({
      data: { error: 0 },
    })
  })

  it('sends the channels of one switch as a single request', async () => {
    const client = makeClient()

    const results = await Promise.all([
      client.sendUpdate(channel('1002792425', 0, 'on')),
      client.sendUpdate(channel('1002792425', 1, 'on')),
      client.sendUpdate(channel('1002792425', 2, 'off')),
    ])

    expect(results).toEqual(['ok', 'ok', 'ok'])
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].url).toMatch(/\/zeroconf\/switches$/)
    expect(sentParams(axios.mock.calls[0]).switches).toEqual([
      { switch: 'on', outlet: 0 },
      { switch: 'on', outlet: 1 },
      { switch: 'off', outlet: 2 },
    ])
  })

  it('keeps the latest value when one channel is written twice', async () => {
    const client = makeClient()

    await Promise.all([
      client.sendUpdate(channel('1002792425', 0, 'on')),
      client.sendUpdate(channel('1002792425', 0, 'off')),
    ])

    expect(axios).toHaveBeenCalledTimes(1)
    expect(sentParams(axios.mock.calls[0]).switches).toEqual([
      { switch: 'off', outlet: 0 },
    ])
  })

  it('still sends to different devices at the same time', async () => {
    const client = makeClient()
    let inFlight = 0
    let mostInFlight = 0
    axios.mockImplementation(async () => {
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 20))
      inFlight -= 1
      return {
        data: { error: 0 },
      }
    })

    await Promise.all([
      client.sendUpdate(channel('1002792425', 0, 'on')),
      client.sendUpdate(channel('1002793b3b', 0, 'on')),
    ])

    expect(axios).toHaveBeenCalledTimes(2)
    expect(mostInFlight).toBe(2)
  })

  it('never has two requests open to the same device', async () => {
    const client = makeClient()
    let inFlight = 0
    let mostInFlight = 0
    axios.mockImplementation(async () => {
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 20))
      inFlight -= 1
      return {
        data: { error: 0 },
      }
    })

    // The first request is already on its way when the next ones arrive, so they
    // wait for it and then go together
    const first = client.sendUpdate(channel('1002792425', 0, 'on'))
    await new Promise(resolve => setTimeout(resolve, 60))
    await Promise.all([
      first,
      client.sendUpdate(channel('1002792425', 1, 'on')),
      client.sendUpdate(channel('1002792425', 2, 'on')),
    ])

    expect(axios).toHaveBeenCalledTimes(2)
    expect(mostInFlight).toBe(1)
    expect(sentParams(axios.mock.calls[1]).switches).toEqual([
      { switch: 'on', outlet: 1 },
      { switch: 'on', outlet: 2 },
    ])
  })

  it('reports the same failure to every channel in a merged request', async () => {
    const client = makeClient()
    axios.mockRejectedValue(Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }))

    const results = await Promise.all([
      client.sendUpdate(channel('1002792425', 0, 'on')),
      client.sendUpdate(channel('1002792425', 1, 'on')),
    ])

    expect(axios).toHaveBeenCalledTimes(1)
    expect(results[0]).toBe(results[1])
    expect(results[0]).not.toBe('ok')
  })

  it('keeps going after a failed request to the same device', async () => {
    const client = makeClient()
    axios.mockRejectedValueOnce(new Error('timeout of 3000ms exceeded'))

    const first = await client.sendUpdate(channel('1002792425', 0, 'on'))
    const second = await client.sendUpdate(channel('1002792425', 0, 'off'))

    expect(first).not.toBe('ok')
    expect(second).toBe('ok')
  })

  it('does not merge updates that are not plain channel changes', async () => {
    const client = makeClient()

    await Promise.all([
      client.sendUpdate({
        deviceid: '1002792425',
        params: { switch: 'on' },
      }),
      client.sendUpdate(channel('1002792425', 1, 'on')),
    ])

    expect(axios).toHaveBeenCalledTimes(2)
  })

  it('does not merge ifan updates, whose switches are read by position', async () => {
    const client = makeClient()
    const fanUpdate = {
      deviceid: '10000ifan1',
      params: {
        switches: [
          { switch: 'on', outlet: 1 },
          { switch: 'off', outlet: 2 },
          { switch: 'off', outlet: 3 },
        ],
      },
    }

    await Promise.all([
      client.sendUpdate(fanUpdate),
      client.sendUpdate(fanUpdate),
    ])

    expect(axios).toHaveBeenCalledTimes(2)
  })
})
