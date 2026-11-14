import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * A pale colour set in the eWeLink app (or sent from HomeKit) comes back as
 * its RGB values. The saturation must be worked out from them, not set to 100,
 * or HomeKit shows a full colour that the light is not showing.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build(name, context) {
  const built = buildHandler(name, deviceTypes[name], {}, context)
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('the saturation of a colour the device reports', () => {
  it('keeps a pale colour pale on a uiid 104 bulb', async () => {
    const { device, accessory } = build('deviceLightRGBCCT', { eweUIID: 104 })

    await device.externalUpdate({
      ltype: 'color',
      color: { br: 50, r: 255, g: 128, b: 128 },
    })

    const saturation = accessory.getService('Lightbulb').getCharacteristic('Saturation').value
    expect(saturation).toBeCloseTo(49.8, 0)
  })

  it('keeps a pale colour pale on the diffuser light', async () => {
    const { device, accessory } = build('deviceDiffuser', { eweUIID: 25 })

    await device.externalUpdate({ lightRcolor: 255, lightGcolor: 128, lightBcolor: 128 })

    const saturation = accessory.getService('Lightbulb').getCharacteristic('Saturation').value
    expect(saturation).toBeCloseTo(49.8, 0)
  })
})
