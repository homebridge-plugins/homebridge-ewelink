import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * UIID 52 shares the colour temperature light handler with UIID 103, but
 * CoolKit's protocol gives it an older shape: `state` for on and off,
 * `channel0` for brightness (10-255) and `channel1` for colour temperature
 * (0-255, where higher is warmer), all sent as strings.
 */

const name = 'deviceLightCCT'
let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build(uiid) {
  const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: uiid })
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  return built
}

describe('a uiid 52 light', () => {
  it('turns on with state', async () => {
    const { device, platform } = build(52)
    await device.internalStateUpdate(true)
    expect(platform.sent.at(-1).params).toEqual({ state: 'on' })
  })

  it('sends brightness as channel0, from 10 to 255', async () => {
    const { device, platform } = build(52)
    await device.internalBrightnessUpdate(100)
    expect(platform.sent.at(-1).params).toEqual({ channel0: '255' })
    await device.internalBrightnessUpdate(1)
    expect(platform.sent.at(-1).params).toEqual({ channel0: '12' })
  })

  it('sends its warmest colour temperature as channel1 255', async () => {
    const { device, platform, accessory } = build(52)
    // The harness's controller is a bare stand-in for HAP's
    accessory.alController.isAdaptiveLightingActive = () => false
    await device.internalCTUpdate(500)
    expect(platform.sent.at(-1).params).toEqual({ channel1: '255' })
  })

  it('follows what the light reports', async () => {
    const { device, accessory } = build(52)
    await device.externalUpdate({ state: 'on', channel0: '255', channel1: '0' })

    const service = accessory.getService('Lightbulb')
    expect(service.getCharacteristic('On').value).toBe(true)
    expect(service.getCharacteristic('Brightness').value).toBe(100)
    // channel1 0 is the coldest, 6500K
    expect(service.getCharacteristic('ColorTemperature').value).toBe(154)
  })
})

describe('a uiid 103 light', () => {
  it('still turns on with switch', async () => {
    const { device, platform } = build(103)
    await device.internalStateUpdate(true)
    expect(platform.sent.at(-1).params).toEqual({ switch: 'on' })
  })
})
