import { describe, expect, it } from 'vitest'

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
