import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * The matter metering switches (UIID 289 two-channel, 290 four-channel) report
 * each channel inside `phase_00`, `phase_01` and so on. CoolKit's protocol gives
 * power in thousandths of a watt and voltage and current in hundredths, and the
 * readings only flow while `uiActive` (a number of seconds) is set.
 */

let devices = []

afterEach(() => {
  devices.forEach((device) => {
    clearTimeout(device.initialTimeout)
    clearInterval(device.intervalPoll)
  })
  devices = []
})

function build(Handler, serviceType) {
  const platform = makePlatform()
  const devicesInHB = new Map()
  const make = (switchNumber) => {
    const accessory = makeAccessory(`Metering ${switchNumber}`, {
      channelCount: 2,
      eweUIID: 289,
      hbDeviceId: `10001abcdeSW${switchNumber}`,
      switchNumber: String(switchNumber),
    })
    const device = new Handler(platform, accessory, devicesInHB)
    devices.push(device)
    devicesInHB.set(platform.api.hap.uuid.generate(`10001abcdeSW${switchNumber}`), accessory)
    return { accessory, device }
  }
  const main = make(0)
  const channels = [
    make(1),
    make(2),
  ]
  return {
    platform,
    main,
    channels,
    serviceType,
  }
}

describe.each([
  ['the switch', deviceTypes.deviceSwitchMulti, 'Switch'],
  ['the outlet', deviceTypes.deviceOutletMulti, 'Outlet'],
])('a matter metering switch, shown as %s', (_, Handler, serviceType) => {
  it('reads each channel\'s power from its phase', async () => {
    const { main, channels } = build(Handler, serviceType)

    await main.device.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
        { switch: 'off', outlet: 1 },
      ],
      phase_00: { current: 100, voltage: 22000, power: 2200000 },
    })

    const service = channels[0].accessory.getService(serviceType)
    expect(service.getCharacteristic('CurrentConsumption').value).toBe(2200)
    expect(service.getCharacteristic('Voltage').value).toBe(220)
    expect(service.getCharacteristic('ElectricCurrent').value).toBe(1)
  })

  it('asks for readings with a number of seconds', async () => {
    const { platform, main } = build(Handler, serviceType)

    await main.device.internalUIUpdate()

    expect(platform.sent.at(-1).params).toEqual({ uiActive: 120 })
  })
})
