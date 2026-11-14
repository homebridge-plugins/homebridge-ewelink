import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { switchForChannel } from '../lib/utils/functions.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Some multi-channel devices (SmartWise two-channel switches, for one) send a
 * partial update holding only the channel that changed - always at position 0,
 * with its real channel in `outlet`. Reading by position applied channel 2's
 * change to channel 1, and the master tile was worked out from the reported
 * channels only, so it went off while another channel was still on (#804).
 */
function twoChannel(Handler, serviceType) {
  const platform = makePlatform()
  const primary = makeAccessory('Two Gang', { channelCount: 2, hbDeviceId: '10001abcdeSW0' })
  const devicesInHB = new Map()
  const channels = [1, 2].map((i) => {
    const sub = makeAccessory(`Two Gang ${i}`, {
      channelCount: 2,
      hbDeviceId: `10001abcdeSW${i}`,
      switchNumber: String(i),
    })
    sub.addService(serviceType)
    sub.eveService = new platform.eveService('switch', sub)
    devicesInHB.set(platform.api.hap.uuid.generate(`10001abcdeSW${i}`), sub)
    return sub
  })
  const device = new Handler(platform, primary, devicesInHB)
  const on = sub => sub.getService(serviceType).getCharacteristic('On').value
  return {
    device,
    primary,
    channels,
    on,
    serviceType,
  }
}

describe.each([
  ['the multi-channel switch', deviceTypes.deviceSwitchMulti, 'Switch'],
  ['the multi-channel outlet', deviceTypes.deviceOutletMulti, 'Outlet'],
])('%s, on a partial update', (_, Handler, serviceType) => {
  it('applies a change to the channel named in outlet, not to channel 1', async () => {
    const { device, channels, on } = twoChannel(Handler, serviceType)

    await device.externalUpdate({
      switches: [
        { switch: 'on', outlet: 1 },
      ],
      updateSource: 'WS',
    })

    expect(on(channels[0])).toBeFalsy()
    expect(on(channels[1])).toBe(true)
  })

  it('keeps the master tile on while another channel is still on', async () => {
    const { device, primary, on } = twoChannel(Handler, serviceType)

    await device.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
        { switch: 'on', outlet: 1 },
      ],
      updateSource: 'WS',
    })
    await device.externalUpdate({
      switches: [
        { switch: 'off', outlet: 1 },
      ],
      updateSource: 'WS',
    })

    expect(on(primary)).toBe(true)
  })
})

describe('finding a channel in a switches array', () => {
  it('matches on outlet when the entries carry it', () => {
    expect(switchForChannel([
      { switch: 'on', outlet: 1 },
    ], 1)).toEqual({ switch: 'on', outlet: 1 })
    expect(switchForChannel([
      { switch: 'on', outlet: 1 },
    ], 0)).toBeUndefined()
  })

  it('falls back to position for a list without outlet numbers', () => {
    expect(switchForChannel([
      { switch: 'off' },
      { switch: 'on' },
    ], 1)).toEqual({ switch: 'on' })
  })

  it('copes with no list at all', () => {
    expect(switchForChannel(undefined, 0)).toBeUndefined()
  })
})
