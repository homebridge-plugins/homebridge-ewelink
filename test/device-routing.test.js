import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import Platform from '../lib/platform.js'
import platformConsts from '../lib/utils/constants.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Which handler the platform picks for a device, by its UIID.
 *
 * This runs the platform's real device set-up, with Homebridge's accessory
 * registration swapped for the test harness, so a model missing from the
 * device lists shows up here as a device nothing was built for.
 */

let built = []

afterEach(() => {
  built.forEach((accessory) => {
    accessory.control?.destroy?.()
    clearInterval(accessory.control?.intervalPoll)
    clearInterval(accessory.control?.intervalPower)
  })
  built = []
})

/** Sets a device of this UIID up, and returns the accessories made for it. */
async function route(uiid, params = {}, deviceConf = {}) {
  const platform = Object.create(Platform.prototype)
  Object.assign(platform, makePlatform({ deviceConf }), {
    hideChannels: [],
    ignoredDevices: [],
    ipOverride: {},
    lanDevices: new Map(),
  })
  platform.addAccessory = (device, hbDeviceId) => {
    const accessory = makeAccessory(device.name, {
      channelCount: platformConsts.supportedDevices[uiid],
      eweDeviceId: device.deviceid,
      eweUIID: uiid,
      hbDeviceId,
      switchNumber: hbDeviceId.split('SW')[1],
    })
    built.push(accessory)
    return accessory
  }
  platform.applyAccessoryLogging = () => {}
  platform.removeAccessory = () => {}
  platform.saveAccessoryUpdate = () => {}

  await platform.initialiseDevice({
    deviceid: '10001abcde',
    extra: { uiid },
    name: `Device ${uiid}`,
    online: true,
    params,
    productModel: 'TEST',
  })

  // A device that fails to set up is only reported in the log
  expect(platform.log.entries.filter(entry => entry.level === 'warn')).toEqual([])
  return built
}

/** The handler classes built, so a test can say which it expected. */
function handlersOf(accessories) {
  return accessories.map(accessory => accessory.control?.constructor)
}

describe('the device routing', () => {
  it('builds the handler a known model has always had', async () => {
    // A check on the routing itself, with a model that was already supported
    expect(handlersOf(await route(7038))).toEqual([deviceTypes.zb.deviceSensorAmbient])
  })
})

describe('the snzb-02b (7052) and snzb-02m (7057) sensors', () => {
  it.each([7052, 7057])('sets up uiid %i as a temperature and humidity sensor', async (uiid) => {
    const accessories = await route(uiid)

    expect(handlersOf(accessories)).toEqual([deviceTypes.zb.deviceSensorAmbient])
  })

  it('reads hundredths of a degree and of a percent', async () => {
    const [accessory] = await route(7052)

    await accessory.control.externalUpdate({ temperature: 2154, humidity: 4870, battery: 90 })

    expect(accessory.getService('TemperatureSensor')
      .getCharacteristic('CurrentTemperature').value).toBe(21.54)
    expect(accessory.getService('HumiditySensor')
      .getCharacteristic('CurrentRelativeHumidity').value).toBe(48)
  })
})

describe('the snzb-06p24 presence sensor (7051)', () => {
  it('sets up as an occupancy sensor', async () => {
    expect(handlersOf(await route(7051))).toEqual([deviceTypes.zb.deviceSensorOccupancy])
  })

  it('shows its presence and its numeric light reading', async () => {
    const [accessory] = await route(7051)

    await accessory.control.externalUpdate({ human: 1, illumination: 120, updateSource: 'WS' })

    expect(accessory.getService('OccupancySensor')
      .getCharacteristic('OccupancyDetected').value).toBe(true)
    expect(accessory.getService('LightSensor')
      .getCharacteristic('CurrentAmbientLightLevel').value).toBe(120)
  })
})
