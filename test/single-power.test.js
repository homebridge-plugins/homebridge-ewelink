import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The single-channel power devices, built as each of the handlers a user can
 * pick for them. A device should show the same readings whether it is shown as
 * a switch or an outlet.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build(name, eweUIID) {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

function powerOf(accessory, serviceName) {
  return accessory.getService(serviceName).getCharacteristic('CurrentConsumption').value
}

describe('a zigbee power plug (7032) shown as an outlet', () => {
  it('shows its power reading, in hundredths of a watt', async () => {
    const { device, accessory } = build('deviceOutletSingle', 7032)

    await device.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
      ],
      power: '5500',
    })

    // The outlet handler had no case for this model, so it showed no power at
    // all, while the same plug shown as a switch did
    expect(powerOf(accessory, 'Outlet')).toBe(55)
  })
})

describe('a smart circuit breaker (226) shown as an outlet', () => {
  it('shows the power it reports under its phase name', async () => {
    const { device, accessory } = build('deviceOutletSingle', 226)

    await device.externalUpdate({ switch: 'on', phase_0_p: '12.5' })

    expect(powerOf(accessory, 'Outlet')).toBe(12.5)
  })
})

describe('a power device set to inching', () => {
  it('reads a powr316 (190) in hundredths, so 55W is not shown as 5500W', async () => {
    const { device, accessory } = build('deviceSwitchSingleInched', 190)

    await device.externalUpdate({ power: '5500', voltage: '23000', current: '24' })

    // The inched handlers never divided, so the reading was a hundred times too big
    const service = accessory.getService('Switch')
    expect(service.getCharacteristic('CurrentConsumption').value).toBe(55)
    expect(service.getCharacteristic('Voltage').value).toBe(230)
    expect(service.getCharacteristic('ElectricCurrent').value).toBe(0.24)
  })

  it('reads an s61 (276) shown as an outlet in hundredths', async () => {
    const { device, accessory } = build('deviceOutletSingleInched', 276)

    await device.externalUpdate({ power: '5500' })

    expect(powerOf(accessory, 'Outlet')).toBe(55)
  })

  it('shows the power of a zigbee power plug (7032) at all', async () => {
    const { device, accessory } = build('deviceSwitchSingleInched', 7032)

    await device.externalUpdate({ power: '5500' })

    expect(powerOf(accessory, 'Switch')).toBe(55)
  })
})
