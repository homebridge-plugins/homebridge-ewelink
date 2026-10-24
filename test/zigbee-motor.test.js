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
