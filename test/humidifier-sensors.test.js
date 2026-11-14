import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The three-speed humidifier (UIID 19) reports the room humidity and
 * temperature, and whether its tank is short of water, as CoolKit's protocol
 * describes. The plugin used to show it only as a fan.
 */

const name = 'deviceHumidifier'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build() {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 19 })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('the three-speed humidifier', () => {
  it('shows the humidity and temperature it reports', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({ humidity: 45, temperature: 21 })

    expect(accessory.getService('HumiditySensor').getCharacteristic('CurrentRelativeHumidity').value).toBe(45)
    expect(accessory.getService('TemperatureSensor').getCharacteristic('CurrentTemperature').value).toBe(21)
  })

  it('adds no sensors for a device that never reports them', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({ switch: 'on', state: 2 })

    expect(accessory.getService('HumiditySensor')).toBeUndefined()
    expect(accessory.getService('TemperatureSensor')).toBeUndefined()
  })

  it('warns once when the tank runs short of water', async () => {
    const { device, platform } = build()

    await device.externalUpdate({ water: 0 })
    await device.externalUpdate({ water: 0 })
    await device.externalUpdate({ water: 1 })
    await device.externalUpdate({ water: 0 })

    const warnings = platform.log.entries.filter(entry => entry.level === 'warn')
    expect(warnings).toHaveLength(2)
  })
})
