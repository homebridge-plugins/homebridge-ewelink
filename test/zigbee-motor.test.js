import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The Zigbee curtain motor (#810), on what a ZBU-CURT-7006 actually sends.
 */

const Handler = deviceTypes.zb.deviceMotor
const name = 'zb.deviceMotor'

function build(context = {}) {
  const built = buildHandler(name, Handler, {}, { eweUIID: 7006, ...context })
  expect(built.error).toBeUndefined()
  return built
}

describe('the zigbee curtain motor', () => {
  it('answers HomeKit once the platform has marked it online', () => {
    const { device, accessory } = build()

    device.markStatus(true)

    // Without markStatus the online flag was never set, so every read from the
    // Home app threw and the curtain showed No Response
    const position = accessory.getService('WindowCovering').getCharacteristic('CurrentPosition')
    expect(() => position.getHandler()).not.toThrow()
  })

  it('shows no response while the platform says it is offline', () => {
    const { device, accessory } = build()

    device.markStatus(false)

    const position = accessory.getService('WindowCovering').getCharacteristic('CurrentPosition')
    expect(() => position.getHandler()).toThrow()
  })
})

describe('the zigbee curtain motor position', () => {
  it('follows the position the motor reports, so Home stops showing opening', async () => {
    const { device, accessory } = build({ eweUIID: 1514 })
    const service = accessory.getService('WindowCovering')

    // A closed curtain at startup, then asked to open
    await device.externalUpdate({ curPercent: 0, openPercent: 0 })
    await device.externalUpdate({ openPercent: 100 })
    expect(service.getCharacteristic('PositionState').value).toBe(1)

    await device.externalUpdate({ curPercent: 100 })

    // The handler read 'curPercen', which never arrives, so the position never
    // moved and Home showed the curtain opening for ever
    expect(service.getCharacteristic('CurrentPosition').value).toBe(100)
    expect(service.getCharacteristic('PositionState').value).toBe(2)
  })
})
