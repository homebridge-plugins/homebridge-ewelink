/**
 * Building every device handler, in one place.
 *
 * Both the snapshot and the logging test walk the same set, and each handler's
 * setup needs are a property of the handler rather than of either test, so they
 * live here.
 */

import deviceTypes from '../lib/device/index.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Context a particular handler reads during setup.
 *
 * A handler left out here gets the harness defaults, which are the shape of an
 * ordinary single-channel switch.
 */
export const CONTEXT_FOR = {
  deviceOutletMulti: { channelCount: 4, switchNumber: '0' },
  deviceSwitchMulti: { channelCount: 4, switchNumber: '0' },
  devicePanel: { channelCount: 4 },
  deviceRfBridge: { buttons: {}, subType: 'button' },
  deviceRfButton: { buttons: { 0: 'Button' }, subType: 'button' },
  deviceRfSensor: { subType: 'motion' },
  deviceGroup: { eweUIID: 5000 },
  // Reads eweParams to decide between a button and a switch
  deviceVirtual: { eweParams: {} },
  // Each takes its three channel numbers from the keys of `buttons`
  deviceRfBlind: { buttons: { 0: 'Open', 1: 'Stop', 2: 'Close' } },
  deviceRfDoor: { buttons: { 0: 'Open', 1: 'Stop', 2: 'Close' } },
  deviceRfWindow: { buttons: { 0: 'Open', 1: 'Stop', 2: 'Close' } },
}

/**
 * Handlers that take more than `(platform, accessory)`.
 *
 * The garage one looks its paired door up in the platform's accessory map and
 * throws when it is not there, and the two RF sensors decorate a second
 * accessory. These are real constructor arguments, so they have to be supplied
 * rather than recorded as a failure.
 */
export const EXTRA_ARGS_FOR = {
  deviceGarageOdSwitch: (platform, accessory) => {
    // The paired door is found through obstructSwitches, which maps this
    // device's id to the id of the garage it reports obstruction for
    const garageId = 'garage001'
    platform.obstructSwitches[accessory.context.eweDeviceId] = garageId
    const garage = makeAccessory('Paired Garage')
    garage.addService('GarageDoorOpener')
    const devicesInHB = new Map()
    devicesInHB.set(platform.api.hap.uuid.generate(`${garageId}SWX`), garage)
    return [devicesInHB]
  },
  deviceSensorHidden: () => [makeAccessory('Paired Sensor')],
  deviceSensorVisible: () => [makeAccessory('Paired Sensor')],
  deviceGateOne: () => [new Map()],
}

/**
 * Where a handler looks its own settings up.
 *
 * Most read `platform.deviceConf` keyed on the eWeLink device id. The RF
 * subdevices are configured separately, under `platform.rfSubdevices` keyed on
 * the Homebridge device id, because several of them hang off one bridge. Any
 * shared base class has to keep that distinction.
 */
export const RF_SUBDEVICE_HANDLERS = new Set([
  'deviceRfButton',
  'deviceRfSensor',
  'sim.deviceRfBlind',
  'sim.deviceRfDoor',
  'sim.deviceRfWindow',
])

/** The platform config that puts `settings` where the named handler will read it. */
export function configFor(name, settings) {
  return RF_SUBDEVICE_HANDLERS.has(name)
    ? { rfSubdevices: { '10001abcdeSW0': settings } }
    : { deviceConf: { '10001abcde': settings } }
}

/**
 * Every handler the plugin can reach, including the simulations and the Zigbee
 * set, flattened to `name -> class` with the nested groups prefixed so a test
 * failure names something findable.
 */
export function everyHandler() {
  const found = []
  Object.entries(deviceTypes).forEach(([name, value]) => {
    if (typeof value === 'function') {
      found.push([name, value])
      return
    }
    // `sim` and `zb` are nested objects of handlers
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([subName, subValue]) => {
        if (typeof subValue === 'function') {
          found.push([`${name}.${subName}`, subValue])
        }
      })
    }
  })
  return found.sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Builds one handler with the platform and accessory it needs.
 *
 * Returns the failure rather than throwing, so a caller checking all of them at
 * once can report every problem instead of stopping at the first.
 */
export function buildHandler(name, Handler, platformOverrides = {}, contextOverrides = {}) {
  const shortName = name.split('.').pop()
  const platform = makePlatform(platformOverrides)
  const accessory = makeAccessory(name, { ...(CONTEXT_FOR[shortName] ?? {}), ...contextOverrides })
  const extra = EXTRA_ARGS_FOR[shortName]?.(platform, accessory) ?? []

  // Several handlers start a polling timer, which would otherwise keep the
  // process alive after the test that built them has finished
  const cleanup = () => {
    clearInterval(accessory.refreshInterval)
    ;['intervalPoll', 'intervalPower', 'initialTimeout'].forEach((timer) => {
      clearInterval(accessory[timer])
      clearTimeout(accessory[timer])
    })
  }

  try {
    const device = new Handler(platform, accessory, ...extra)
    ;['intervalPoll', 'intervalPower', 'initialTimeout'].forEach((timer) => {
      clearInterval(device[timer])
      clearTimeout(device[timer])
    })
    return { device, platform, accessory, cleanup }
  } catch (err) {
    return { error: err.message, platform, accessory, cleanup }
  }
}
