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
async function route(uiid, params = {}, deviceConf = {}, platformExtras = {}, deviceExtras = {}) {
  const platform = Object.create(Platform.prototype)
  Object.assign(platform, makePlatform({ deviceConf }), {
    hideChannels: [],
    ignoredDevices: [],
    ipOverride: {},
    lanDevices: new Map(),
  }, platformExtras)
  platform.addAccessory = (device, hbDeviceId, hidden, extraContext = {}) => {
    const accessory = makeAccessory(device.name, {
      ...extraContext,
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
    ...deviceExtras,
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

describe('the mini-zb1gp zigbee switch (7054)', () => {
  it('sets up as a single switch', async () => {
    expect(handlersOf(await route(7054))).toEqual([deviceTypes.deviceSwitchSingle])
  })

  it('follows the first channel and reads power in hundredths', async () => {
    const [accessory] = await route(7054)

    await accessory.control.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
      ],
      power: '1250',
      voltage: '23010',
      current: '6',
    })

    const service = accessory.getService('Switch')
    expect(service.getCharacteristic('On').value).toBe(true)
    expect(service.getCharacteristic('CurrentConsumption').value).toBe(12.5)
    expect(service.getCharacteristic('Voltage').value).toBe(230.1)
  })

  it('reads power the same when shown as an outlet', async () => {
    const [accessory] = await route(7054, {}, {
      '10001abcde': { showAs: 'outlet' },
    })

    await accessory.control.externalUpdate({ power: '1250' })

    expect(accessory.getService('Outlet').getCharacteristic('CurrentConsumption').value).toBe(12.5)
  })
})

describe('the mini-1gsp switch (283)', () => {
  it('sets up as a single switch', async () => {
    expect(handlersOf(await route(283))).toEqual([deviceTypes.deviceSwitchSingle])
  })

  it('follows the first channel and reads power in hundredths', async () => {
    const [accessory] = await route(283)

    await accessory.control.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
      ],
      power: '6025',
    })

    const service = accessory.getService('Switch')
    expect(service.getCharacteristic('On').value).toBe(true)
    expect(service.getCharacteristic('CurrentConsumption').value).toBe(60.25)
  })
})

describe('the two-way metering socket (294)', () => {
  // CoolKit's protocol says it is the same as the mini-1gsp (283)
  it('sets up as a single switch', async () => {
    expect(handlersOf(await route(294))).toEqual([deviceTypes.deviceSwitchSingle])
  })

  it('follows the first channel and reads power in hundredths', async () => {
    const [accessory] = await route(294)

    await accessory.control.externalUpdate({
      switches: [
        { switch: 'on', outlet: 0 },
      ],
      power: '6025',
    })

    const service = accessory.getService('Switch')
    expect(service.getCharacteristic('On').value).toBe(true)
    expect(service.getCharacteristic('CurrentConsumption').value).toBe(60.25)
  })
})

describe('the four-channel remote switch (163)', () => {
  it('sets up as a four-channel switch, like its 1-3 channel siblings', async () => {
    const accessories = await route(163)

    // The hidden main accessory, then one per channel
    expect(handlersOf(accessories)).toEqual(Array.from({ length: 5 }).fill(deviceTypes.deviceSwitchMulti))
    expect(accessories.at(-1).context.hbDeviceId).toBe('10001abcdeSW4')
  })
})

describe('the matter metering switches (289 and 290)', () => {
  // The hidden main accessory, then one per channel
  it('sets up two channels on the 289', async () => {
    expect(await route(289)).toHaveLength(3)
  })

  it('sets up four channels on the 290', async () => {
    expect(await route(290)).toHaveLength(5)
  })
})

describe('the nspanel86pb relay (278)', () => {
  it('sets up as a two-channel switch', async () => {
    const accessories = await route(278)

    // The hidden main accessory, then one per channel
    expect(handlersOf(accessories)).toEqual([
      deviceTypes.deviceSwitchMulti,
      deviceTypes.deviceSwitchMulti,
      deviceTypes.deviceSwitchMulti,
    ])
    expect(accessories.map(accessory => accessory.context.hbDeviceId)).toEqual([
      '10001abcdeSW0',
      '10001abcdeSW1',
      '10001abcdeSW2',
    ])
  })
})

describe('the second generation zigbee radiator valve (7049)', () => {
  it('sets up on the same thermostat as the first (7017)', async () => {
    expect(handlersOf(await route(7049))).toEqual([deviceTypes.zb.deviceThermostat])
  })

  it('reads tenths of a degree, as the first generation does', async () => {
    const [accessory] = await route(7049)

    await accessory.control.externalUpdate({ temperature: 215 })

    expect(accessory.getService('Thermostat')
      .getCharacteristic('CurrentTemperature').value).toBe(21.5)
  })
})

describe('the tp-wgzba zigbee wall thermostat (7050)', () => {
  /** The thermostat's Home service, set up from a device in this state. */
  async function thermostat(params = {}) {
    const [accessory] = await route(7050, params)
    return {
      accessory,
      service: accessory.getService('Thermostat'),
    }
  }

  it('sets up on the same thermostat as the radiator valves', async () => {
    expect(handlersOf(await route(7050))).toEqual([deviceTypes.zb.deviceThermostat])
  })

  it('reads its temperatures in tenths of a degree', async () => {
    const { accessory, service } = await thermostat()

    await accessory.control.externalUpdate({ temperature: 242, curTargetTemp: 220 })

    expect(service.getCharacteristic('CurrentTemperature').value).toBe(24.2)
    expect(service.getCharacteristic('TargetTemperature').value).toBe(22)
  })

  it('offers only heat and auto, as the value for off is not known', async () => {
    const { service } = await thermostat()
    const targetState = service.getCharacteristic('TargetHeatingCoolingState')

    expect(targetState.props.validValues).toEqual([1, 3])
    expect([1, 3]).toContain(targetState.value)
  })

  it('follows heat and auto from the device', async () => {
    const { accessory, service } = await thermostat()
    const targetState = service.getCharacteristic('TargetHeatingCoolingState')

    await accessory.control.externalUpdate({ workMode: '2' })
    expect(targetState.value).toBe(3)

    await accessory.control.externalUpdate({ workMode: '0' })
    expect(targetState.value).toBe(1)
  })

  it('leaves an unknown mode as it is in home, and logs it once', async () => {
    const { accessory, service } = await thermostat()
    const targetState = service.getCharacteristic('TargetHeatingCoolingState')

    await accessory.control.externalUpdate({ workMode: '0' })
    await accessory.control.externalUpdate({ workMode: '5' })
    await accessory.control.externalUpdate({ workMode: '5' })

    expect(targetState.value).toBe(1)
    const logged = accessory.control.platform.log.entries
      .filter(entry => String(entry.args[0]).includes('unknown work mode'))
    expect(logged).toHaveLength(1)
  })

  it('still shows a radiator valve in mode 1 as off', async () => {
    const [accessory] = await route(7017)

    await accessory.control.externalUpdate({ workMode: '1' })

    expect(accessory.getService('Thermostat')
      .getCharacteristic('TargetHeatingCoolingState').value).toBe(0)
  })
})

describe('the two-zone zigbee irrigation valve (7048)', () => {
  it('sets up as a zigbee water valve', async () => {
    expect(handlersOf(await route(7048))).toEqual([deviceTypes.zb.deviceZigbeeWaterValve])
  })
})

describe('the state a device starts from', () => {
  it('is written to the debug log, so a wrong start can be traced to the cloud (#810)', async () => {
    // Only a cloud connection hands the device a starting state
    const params = { curPercent: 100, openPercent: 0 }
    const [accessory] = await route(7006, params, {}, { wsClient: {} })

    expect(accessory.logDebug.messages()).toContain(`receiving update ${JSON.stringify(params)}`)
  })
})

describe('an rf bridge curtain', () => {
  // A curtain remote (type 5) can be shown as a blind, door or window. The
  // handler was looked up by a file path string, which is not a class, so
  // setting one of these up threw "is not a constructor".
  it.each([
    ['blind', 'deviceRfBlind'],
    ['door', 'deviceRfDoor'],
    ['window', 'deviceRfWindow'],
  ])('sets up a curtain shown as a %s', async (curtainType, handler) => {
    const accessories = await route(28, {}, {}, {
      hideMasters: [],
      rfSubdevices: {
        '10001abcdeSW1': { curtainType },
      },
    }, {
      tags: {
        zyx_info: [
          {
            name: 'Curtain',
            remote_type: '5',
            buttonName: [
              { 0: 'Open' },
            ],
          },
        ],
      },
    })

    expect(handlersOf(accessories)).toContain(deviceTypes.sim[handler])
  })
})
