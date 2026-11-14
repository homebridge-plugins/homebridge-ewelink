import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The Sonoff SC (UIID 18) reports light as a level from 1 to 10. CoolKit's
 * protocol says 1-3 is bright and 8-10 is dark, so 1 is the brightest.
 */

const name = 'deviceSensorTempHumi'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build() {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 18 })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

function lux(accessory) {
  return accessory.getService('LightSensor').getCharacteristic('CurrentAmbientLightLevel').value
}

describe('the sonoff sc light level', () => {
  it('shows a bright room as more light than a dark one', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({ light: '1' })
    const bright = lux(accessory)
    await device.externalUpdate({ light: '10' })
    const dark = lux(accessory)

    expect(bright).toBe(100)
    expect(dark).toBe(10)
  })
})

describe('the sonoff sc dust level', () => {
  it('grades the level with the bands in coolkit\'s protocol', async () => {
    const { device, accessory } = build()
    const quality = () => accessory.getService('AirQualitySensor').getCharacteristic('AirQuality').value

    await device.externalUpdate({ dusty: 3 })
    expect(quality()).toBe(1)
    await device.externalUpdate({ dusty: 6 })
    expect(quality()).toBe(2)
    await device.externalUpdate({ dusty: 7 })
    expect(quality()).toBe(5)
  })
})
