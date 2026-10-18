import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import ApiServer from '../lib/connection/api.js'
import deviceTypes from '../lib/device/index.js'
import { buildHandler, configFor } from './build-handlers.js'
import { makeAccessory, makePlatform } from './harness.js'

const name = 'deviceFan'
const Handler = deviceTypes.deviceFan

function speedChar(accessory) {
  return accessory.getService('Fan').getCharacteristic('RotationSpeed')
}

// The three speed channels the iFan is sent, as on/off for outlets 1-3
function outlets(sent) {
  return sent.params.switches.map(s => s.switch)
}

describe('the iFan speed scale (#551)', () => {
  it('uses levels 1-3 by default', async () => {
    const { accessory, platform } = buildHandler(name, Handler)
    expect(speedChar(accessory).props.maxValue).toBe(3)

    await speedChar(accessory).setHandler(2)
    expect(outlets(platform.sent[0])).toEqual(['on', 'on', 'off'])
  })

  it('uses a percentage when speedAsPercent is set, so siri can pick low, medium or high', async () => {
    const { device, accessory, platform } = buildHandler(name, Handler, configFor(name, { speedAsPercent: true }))
    expect(speedChar(accessory).props).toMatchObject({ maxValue: 100, minStep: 33, unit: 'percentage' })

    // 66 is medium, which on the level scale was out of range and turned the fan off
    await speedChar(accessory).setHandler(66)
    expect(outlets(platform.sent[0])).toEqual(['on', 'on', 'off'])

    await device.externalUpdate({ switches: [{ switch: 'off' }, { switch: 'on' }, { switch: 'off' }, { switch: 'on' }], updateSource: 'WS' })
    expect(speedChar(accessory).value).toBe(99)
    expect(device.currentState().fan.speed).toBe('high')
  })

  it('rebuilds a fan cached on the level scale when the option is turned on', () => {
    const accessory = makeAccessory(name)
    const old = accessory.addService('Fan')
    old.getCharacteristic('RotationSpeed').setProps({ maxValue: 3, minStep: 1 })

    // eslint-disable-next-line no-new
    new Handler(makePlatform(configFor(name, { speedAsPercent: true })), accessory)
    expect(accessory.getService('Fan')).not.toBe(old)
    expect(speedChar(accessory).props.maxValue).toBe(100)
  })
})

/**
 * The plugin's own HTTP control api names speeds low, medium and high, and
 * always turned them into a percentage. A fan that counts in levels 1 to 3
 * read 66 as out of range - so asking for medium switched the fan off.
 */
describe('setting a fan speed through the http api', () => {
  async function setSpeedOverApi(overrides, speed) {
    const built = buildHandler(name, Handler, overrides)
    built.accessory.context.hbDeviceId = 'fan-1'
    built.accessory.control = built.device
    built.platform.config.username = 'user'
    built.platform.config.password = 'pass'
    const devicesInHB = new Map([[built.platform.api.hap.uuid.generate('fan-1'), built.accessory]])
    const api = new ApiServer(built.platform, devicesInHB)
    await api.action({
      url: `/set/fan-1/fan/speed/${speed}`,
      headers: { authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` },
    })
    return built
  }

  it('sends medium as medium to a fan on the level scale', async () => {
    const { platform } = await setSpeedOverApi(undefined, 'medium')
    expect(outlets(platform.sent[0])).toEqual(['on', 'on', 'off'])
  })

  it('sends medium as medium to a fan on the percentage scale', async () => {
    const { platform } = await setSpeedOverApi(configFor(name, { speedAsPercent: true }), 'medium')
    expect(outlets(platform.sent[0])).toEqual(['on', 'on', 'off'])
  })
})
