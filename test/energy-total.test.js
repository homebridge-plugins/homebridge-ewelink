import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * Plugs with power readings build Eve's total consumption from the watts they
 * report, adding one window every 30 seconds. The window used to be 5 minutes,
 * and when it was shortened the maths kept dividing by 12 (the number of 5
 * minute windows in an hour) instead of 120, so totals grew 10 times too fast.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

describe.each(['deviceOutletSingle', 'deviceOutletSingleInched'])('%s total consumption', (name) => {
  it('adds the energy of a 30 second window at the watts reported', () => {
    const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 32 })
    cleanups.push(built.cleanup)
    expect(built.error).toBeUndefined()
    const { device, accessory } = built

    // 1200W for 30 seconds is 10Wh, which is 0.01kWh
    accessory.context.energyReadingTotal = 0
    accessory.context.energyReadings = [1000, 1400]
    device.addEnergyWindow()

    const total = accessory.getService('Outlet').getCharacteristic('TotalConsumption').value
    expect(total).toBeCloseTo(0.01, 6)
    expect(accessory.context.energyReadings).toEqual([])
  })
})
