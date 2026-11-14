import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * With its relay separated, the MINI-1GSP (UIID 283) reports presses of the
 * wall switch as `localKeyPass`: 0 single, 1 double and 2 long, which CoolKit's
 * protocol documents. They become a HomeKit button, added on the first press
 * and kept from then on, so automations made on it survive a restart.
 */

const Handler = deviceTypes.deviceSwitchSingle
let devices = []

afterEach(() => {
  devices.forEach((device) => {
    clearTimeout(device.initialTimeout)
    clearInterval(device.intervalPoll)
  })
  devices = []
})

function build(accessory = makeAccessory('MINI-1GSP', { eweUIID: 283 })) {
  const device = new Handler(makePlatform(), accessory)
  devices.push(device)
  return { device, accessory }
}

describe('the mini-1gsp wall switch', () => {
  it('has no button until the wall switch is pressed', () => {
    const { accessory } = build()
    expect(accessory.getService('StatelessProgrammableSwitch')).toBeUndefined()
  })

  it('shows a long press as a long press', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({
      localKeyPass: { outlet: 0, key: 2 },
    })

    const button = accessory.getService('StatelessProgrammableSwitch')
    expect(button.getCharacteristic('ProgrammableSwitchEvent').value).toBe(2)
  })

  it('keeps the button after a restart', async () => {
    const { device, accessory } = build()
    await device.externalUpdate({
      localKeyPass: { outlet: 0, key: 0 },
    })

    build(accessory)

    expect(accessory.getService('StatelessProgrammableSwitch')).toBeDefined()
  })

  it('ignores a rocker turned on or off, which a button cannot show', async () => {
    const { device, accessory } = build()

    await device.externalUpdate({
      localKeyPass: { outlet: 0, key: 3 },
    })

    expect(accessory.getService('StatelessProgrammableSwitch')).toBeUndefined()
  })
})
