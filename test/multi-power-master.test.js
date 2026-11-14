import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The main tile of a multi-channel switch turns every channel on or off. The
 * power models were all treated as two-channel, so on a four-channel one
 * (UIID 262) the main tile only reached channels 1 and 2.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

describe.each(['deviceSwitchMulti', 'deviceOutletMulti'])('%s main tile', (name) => {
  function build(uiid, channelCount) {
    const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: uiid, channelCount, switchNumber: '0' })
    cleanups.push(built.cleanup)
    expect(built.error).toBeUndefined()
    // The channel accessories, which a real platform passes in
    built.device.devicesInHB = new Map()
    return built
  }

  it('turns all four channels of a four-channel power switch on', async () => {
    const { device, platform } = build(262, 4)
    await device.internalStateUpdate(true)
    expect(platform.sent.at(-1).params.switches.map(entry => entry.outlet)).toEqual([0, 1, 2, 3])
  })

  it('still turns just the two channels of a dualr3 on', async () => {
    const { device, platform } = build(126, 2)
    await device.internalStateUpdate(true)
    expect(platform.sent.at(-1).params.switches.map(entry => entry.outlet)).toEqual([0, 1])
  })
})
