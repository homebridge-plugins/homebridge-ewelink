import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import platformConsts from '../lib/utils/constants.js'
import { buildHandler } from './build-handlers.js'

/**
 * The air quality sensors on UIID 266. The SAWF-08P measures CO2, and the
 * SAWF-07P measures particles too, as pm2_5 and pm10 in µg/m³.
 */

const name = 'deviceSensorAirQuality'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build() {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 266 })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('the air quality sensor', () => {
  it('shows the particle readings of a model that sends them', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({ co2: 520, pm2_5: 12, pm10: 30 })

    const service = accessory.getService('AirQualitySensor')
    expect(service.getCharacteristic('PM2_5Density').value).toBe(12)
    expect(service.getCharacteristic('PM10Density').value).toBe(30)
  })

  it('adds no particle readings to a model that never sends them', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({ co2: 520 })

    const service = accessory.getService('AirQualitySensor')
    expect(service.testCharacteristic('PM2_5Density')).toBe(false)
    expect(service.testCharacteristic('PM10Density')).toBe(false)
  })

  it('keeps the particle readings in live updates', () => {
    // Stripped of digits these would be 'pm_' and 'pm', which are not kept
    expect(platformConsts.paramsToKeep).toEqual(expect.arrayContaining(['pm2_5', 'pm10']))
  })
})
