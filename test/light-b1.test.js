import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The Sonoff B1 (UIID 22). CoolKit's protocol gives it a white mode with
 * brightness, channel0 (cold) and channel1 (warm) from 25 to 255, and three
 * white tones: cold, middle and warm. The plugin used to offer colour only.
 */

const name = 'deviceLightRGB'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build() {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 22 })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('the sonoff b1 in white mode', () => {
  it('sends a warm white for a warm colour temperature', async () => {
    const { device, platform } = build()

    await device.internalCTUpdate(450)

    expect(platform.sent.at(-1).params).toEqual({
      zyx_mode: 1,
      type: 'warm',
      channel0: '0',
      channel1: '255',
    })
  })

  it('dims the white it is showing', async () => {
    const { device, platform } = build()
    await device.externalUpdate({
      zyx_mode: 1,
      type: 'cold',
      channel0: '255',
      channel1: '0',
    })

    await device.internalBrightnessUpdate(50)

    expect(platform.sent.at(-1).params).toEqual({
      zyx_mode: 1,
      type: 'cold',
      channel0: '139',
      channel1: '0',
    })
  })

  it('shows the brightness and tone the bulb reports', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({
      zyx_mode: 1,
      type: 'middle',
      channel0: '139',
      channel1: '139',
    })

    const service = accessory.getService('Lightbulb')
    expect(service.getCharacteristic('Brightness').value).toBe(50)
    expect(service.getCharacteristic('ColorTemperature').value).toBe(250)
  })
})

describe('the sonoff b1 in colour mode', () => {
  it('scales the colour by the brightness', async () => {
    const { device, platform } = build()
    await device.externalUpdate({
      zyx_mode: 2,
      channel2: '255',
      channel3: '0',
      channel4: '0',
    })

    await device.internalBrightnessUpdate(50)

    expect(platform.sent.at(-1).params).toMatchObject({
      zyx_mode: 2,
      channel2: '128',
      channel3: '0',
      channel4: '0',
    })
  })
})
