import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { probeHasHumidity } from '../lib/utils/functions.js'
import { buildHandler } from './build-handlers.js'

/**
 * A TH switch with a WTS01 probe measures temperature only, and reports its
 * humidity as "unavailable". The plugin still showed a humidity sensor, stuck
 * at 0% (#819). It already left it out for the DS18B20 probe.
 */

const name = 'deviceSensorAmbient'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build(sensorType) {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 181, sensorType })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('the humidity sensor of a th switch', () => {
  it.each(['DS18B20', 'WTS01'])('is left out for the temperature-only %s probe', async (sensorType) => {
    const { device, accessory } = build(sensorType)

    await device.externalUpdate({ currentTemperature: '26.4', currentHumidity: 'unavailable' })

    expect(accessory.getService('HumiditySensor')).toBeUndefined()
    expect(accessory.getService('TemperatureSensor').getCharacteristic('CurrentTemperature').value).toBe(26.4)
  })

  it.each(['THS01', 'AM2301', undefined])('is shown for the %s probe', async (sensorType) => {
    const { device, accessory } = build(sensorType)

    await device.externalUpdate({ currentTemperature: '21.5', currentHumidity: '45' })

    expect(accessory.getService('HumiditySensor').getCharacteristic('CurrentRelativeHumidity').value).toBe(45)
  })
})

describe('probeHasHumidity', () => {
  it('knows the temperature-only probes', () => {
    expect(probeHasHumidity('DS18B20')).toBe(false)
    expect(probeHasHumidity('WTS01')).toBe(false)
    expect(probeHasHumidity('THS01')).toBe(true)
    expect(probeHasHumidity(undefined)).toBe(true)
  })
})
