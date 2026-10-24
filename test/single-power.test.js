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
