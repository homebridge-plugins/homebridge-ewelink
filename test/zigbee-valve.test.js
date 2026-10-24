import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import platformConsts from '../lib/utils/constants.js'
import { buildHandler } from './build-handlers.js'

/**
 * The Zigbee irrigation valves. The two-zone SWV-ZF2E (7048) reports and takes
 * each valve under its own param, switch_00 and switch_01, as true or false.
 */

const name = 'zb.deviceZigbeeWaterValve'
let devices = []

afterEach(() => {
  devices.forEach(device => device.destroy())
  devices = []
})

function build(eweUIID) {
  const built = buildHandler(name, deviceTypes.zb.deviceZigbeeWaterValve, {}, { eweUIID })
  expect(built.error).toBeUndefined()
  devices.push(built.device)
  return built
}

function valves(accessory) {
  return accessory.services.filter(service => service.type === 'Valve')
}

describe('the two-zone zigbee irrigation valve (7048)', () => {
  it('shows a valve for each zone', () => {
    const { accessory } = build(7048)

    expect(valves(accessory).map(service => service.subtype)).toEqual(['valve1', 'valve2'])
  })

  it('follows each zone on its own param', async () => {
    const { device, accessory } = build(7048)
    const [first, second] = valves(accessory)

    await device.externalUpdate({ switch_00: false, switch_01: true })

    expect(first.getCharacteristic('Active').value).toBe(0)
    expect(second.getCharacteristic('Active').value).toBe(1)
  })

  it('opens the second zone with its own param', async () => {
    const { platform, accessory } = build(7048)
    const second = valves(accessory)[1]

    await second.getCharacteristic('Active').setHandler(1)

    expect(platform.sent.map(command => command.params)).toEqual([
      { switch_01: true },
    ])
  })

  it('keeps the second zone in live updates', () => {
    // Stripped of digits it would be 'switch_', which is not kept
    expect(platformConsts.paramsToKeep).toContain('switch_01')
  })
})

describe('the single zigbee irrigation valves', () => {
  it.each([
    [7027, 'switch'],
    [7047, 'switch_00'],
  ])('keep one valve on uiid %i, sent as %s', async (uiid, param) => {
    const { platform, accessory } = build(uiid)

    expect(valves(accessory)).toHaveLength(1)
    await valves(accessory)[0].getCharacteristic('Active').setHandler(1)

    expect(platform.sent.map(command => command.params)).toEqual([
      { [param]: true },
    ])
  })
})
