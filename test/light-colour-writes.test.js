import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { hs2rgb, m2hs } from '../lib/utils/colour.js'
import { buildHandler } from './build-handlers.js'

/**
 * HomeKit sends a colour as two characteristics, hue and saturation, and a
 * scene or automation sends both in one request. HAP-NodeJS starts every set
 * handler in that request at once, and only stores a characteristic's new value
 * after its own handler has finished. So a handler that reads the other
 * characteristic's value reads the PREVIOUS one, and a light could be sent the
 * colour it had before instead of the one the scene asked for.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

function build(name, Handler, context) {
  const built = buildHandler(name, Handler, {}, context)
  cleanups.push(built.cleanup)
  expect(built.error).toBeUndefined()
  // The harness's adaptive lighting controller is a bare stand-in, and the
  // colour code asks it whether it is active
  if (built.accessory.alController) {
    built.accessory.alController.isAdaptiveLightingActive = () => false
    built.accessory.alController.disableAdaptiveLighting = () => {}
  }
  return built
}

/**
 * Writes characteristics the way HAP-NodeJS does for one HomeKit request: every
 * set handler starts at once, and a characteristic only takes its new value once
 * its own handler has finished. One with no handler takes its value straight
 * away, and one whose handler fails keeps its old value.
 */
async function homeWrites(service, pairs) {
  await Promise.all(pairs.map(async ([name, value]) => {
    const characteristic = service.getCharacteristic(name)
    if (!characteristic.setHandler) {
      characteristic.value = value
      return
    }
    try {
      await characteristic.setHandler(value)
      characteristic.value = value
    } catch {
      // HomeKit is told the write failed, and the value stays as it was
    }
  }))
}

const LIGHTS = [
  {
    name: 'the sonoff b1',
    build: () => build('deviceLightRGB', deviceTypes.deviceLightRGB, { eweUIID: 22 }),
    // The B1 sends its colour as the RGB channels, scaled by the brightness,
    // which is 100 here
    colours: platform => platform.sent
      .map(({ params }) => params)
      .filter(params => params.zyx_mode === 2)
      .map(params => [params.channel2, params.channel3, params.channel4].map(Number)),
    expected: (hue, sat) => hs2rgb(hue, sat).map(x => Math.round(x)),
    reportBlue: device => device.externalUpdate({
      zyx_mode: 2,
      channel2: '0',
      channel3: '0',
      channel4: '255',
    }),
    hasColourTemperature: false,
  },
  {
    name: 'a uiid 104 bulb',
    build: () => build('deviceLightRGBCCT', deviceTypes.deviceLightRGBCCT, { eweUIID: 104 }),
    colours: platform => platform.sent
      .map(({ params }) => params)
      .filter(params => params.color)
      .map(({ color }) => [color.r, color.g, color.b]),
    expected: (hue, sat) => hs2rgb(hue, sat),
    reportBlue: device => device.externalUpdate({
      ltype: 'color',
      color: { br: 100, r: 0, g: 0, b: 255 },
    }),
    hasColourTemperature: true,
  },
  {
    name: 'a zigbee colour bulb',
    build: () => build('zb.deviceLightRGBCCT', deviceTypes.zb.deviceLightRGBCCT, { eweUIID: 3258 }),
    // A Zigbee bulb takes hue and saturation as they are
    colours: platform => platform.sent
      .map(({ params }) => params)
      .filter(params => 'hue' in params)
      .map(params => [params.hue, params.saturation]),
    expected: (hue, sat) => [hue, sat],
    reportBlue: device => device.externalUpdate({
      colorMode: 'rgb',
      hue: 240,
      saturation: 100,
    }),
    hasColourTemperature: true,
  },
]

describe.each(LIGHTS)('$name', (light) => {
  it('sends the new colour once when home writes hue then saturation', async () => {
    const { device, platform } = light.build()

    // A warm orange, as a scene would set it
    await homeWrites(device.service, [
      ['Hue', 25],
      ['Saturation', 96],
    ])

    expect(light.colours(platform)).toEqual([
      light.expected(25, 96),
    ])
  })

  it('sends the new colour once when home writes saturation then hue', async () => {
    const { device, platform } = light.build()

    await homeWrites(device.service, [
      ['Saturation', 50],
      ['Hue', 120],
    ])

    expect(light.colours(platform)).toEqual([
      light.expected(120, 50),
    ])
  })

  it('turns a blue light orange, not back to blue, when a scene repeats the saturation', async () => {
    const { device, platform } = light.build()
    await light.reportBlue(device)

    await homeWrites(device.service, [
      ['Hue', 25],
      ['Saturation', 100],
    ])

    expect(light.colours(platform)).toEqual([
      light.expected(25, 100),
    ])
  })

  it('sends a change of saturation alone, keeping the hue the light reported', async () => {
    const { device, platform } = light.build()
    await light.reportBlue(device)

    await homeWrites(device.service, [
      ['Saturation', 50],
    ])

    // Blue at 50%, not the hue from before the light reported blue
    expect(light.colours(platform)).toEqual([
      light.expected(240, 50),
    ])
  })

  it('goes back to the colour the light really has after a failed send', async () => {
    const { device, platform } = light.build()
    await light.reportBlue(device)

    const send = platform.sendDeviceUpdate
    platform.sendDeviceUpdate = async () => {
      throw new Error('offline')
    }
    await homeWrites(device.service, [
      ['Hue', 25],
    ])
    platform.sendDeviceUpdate = send

    await homeWrites(device.service, [
      ['Saturation', 50],
    ])

    // The light stayed blue, so it is blue that gets paler, not the orange
    // that was never sent
    expect(light.colours(platform)).toEqual([
      light.expected(240, 50),
    ])
  })
})

describe.each(LIGHTS.filter(light => light.hasColourTemperature))('$name', (light) => {
  it('keeps the hue of a colour temperature when home then changes only the saturation', async () => {
    const { device, platform } = light.build()

    await device.internalCTUpdate(300)
    const [hue] = m2hs(300)

    await homeWrites(device.service, [
      ['Saturation', 80],
    ])

    expect(light.colours(platform)).toEqual([
      light.expected(hue, 80),
    ])
  })
})

describe('the diffuser light', () => {
  it('sends the new saturation when home writes hue then saturation', async () => {
    const { device, platform } = build('deviceDiffuser', deviceTypes.deviceDiffuser, { eweUIID: 25 })
    device.cacheState = 'on'

    // The diffuser has no saturation handler, so HAP-NodeJS stores the
    // saturation straight away, but only after the hue handler has started
    await homeWrites(device.lightService, [
      ['Hue', 25],
      ['Saturation', 96],
    ])

    const sent = platform.sent
      .map(({ params }) => params)
      .filter(params => 'lightRcolor' in params)
      .map(params => [params.lightRcolor, params.lightGcolor, params.lightBcolor])
    expect(sent).toEqual([
      hs2rgb(25, 96),
    ])
  })
})
