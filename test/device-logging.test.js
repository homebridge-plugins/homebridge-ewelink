import { describe, expect, it } from 'vitest'

import { buildHandler, configFor, everyHandler } from './build-handlers.js'

/**
 * The twelve-line preamble every device handler opens with, checked in all of
 * them at once.
 *
 * This block - read the per-device config, then a four-way switch on
 * `overrideLogging` - is copied into seventy-five files. That is the single
 * biggest source of duplication in the plugin and the obvious thing to collapse
 * into a shared base class.
 *
 * Running the same expectations across every handler does two jobs. Now, it
 * says whether the seventy-five copies really are identical or whether some
 * have quietly drifted. Afterwards, it is what shows the collapse changed
 * nothing.
 */

const MODES = [
  {
    name: 'standard',
    overrideLogging: 'standard',
    disableDeviceLogging: false,
    expected: { enableLogging: true, enableDebugLogging: false },
  },
  {
    name: 'standard, even when device logging is off globally',
    overrideLogging: 'standard',
    disableDeviceLogging: true,
    expected: { enableLogging: true, enableDebugLogging: false },
  },
  {
    name: 'debug',
    overrideLogging: 'debug',
    disableDeviceLogging: false,
    expected: { enableLogging: true, enableDebugLogging: true },
  },
  {
    name: 'disable',
    overrideLogging: 'disable',
    disableDeviceLogging: false,
    expected: { enableLogging: false, enableDebugLogging: false },
  },
  {
    name: 'unset, following the global setting when it is on',
    overrideLogging: undefined,
    disableDeviceLogging: false,
    expected: { enableLogging: true, enableDebugLogging: false },
  },
  {
    name: 'unset, following the global setting when it is off',
    overrideLogging: undefined,
    disableDeviceLogging: true,
    expected: { enableLogging: false, enableDebugLogging: false },
  },
]

/**
 * A handler that does not keep these flags at all. The obstruction switch is a
 * passthrough onto another accessory's service - it logs nothing of its own, so
 * it never grew the preamble.
 */
const NO_LOGGING_FLAGS = new Set(['sim.deviceGarageOdSwitch'])

/**
 * Handlers that deliberately do not follow the shared preamble.
 *
 * These are the copies that have drifted, checked one by one. They are listed
 * rather than quietly skipped, so that collapsing the preamble into a base
 * class has to make a decision about each of them instead of flattening them by
 * accident.
 */
const KNOWN_EXCEPTIONS = new Map([
  [
    'deviceTemplate',
    // The handler for a device the plugin does not recognise. It logs
    // everything on purpose, because the log is how an owner reports what the
    // device sent and gets it supported.
    'always verbose - it is the unknown-device handler',
  ],
  [
    'sim.deviceSensorHidden',
    // A sensor tied to another accessory, so it follows that device's setting
    // rather than its own, and has no debug level of its own to set.
    'follows the paired device\'s setting, and has no debug level',
  ],
])

describe('the per-device logging setting', () => {
  const handlers = everyHandler().filter(([name]) => (
    !NO_LOGGING_FLAGS.has(name) && !KNOWN_EXCEPTIONS.has(name)
  ))

  MODES.forEach((mode) => {
    it(`is honoured as ${mode.name}, in every handler`, () => {
      const wrong = []

      handlers.forEach(([name, Handler]) => {
        const built = buildHandler(name, Handler, {
          config: { disableDeviceLogging: mode.disableDeviceLogging },
          ...(mode.overrideLogging === undefined
            ? {}
            : configFor(name, { overrideLogging: mode.overrideLogging })),
        })

        if (!built.device) {
          wrong.push(`${name}: did not build - ${built.error}`)
          return
        }

        const actual = {
          enableLogging: built.device.enableLogging,
          enableDebugLogging: built.device.enableDebugLogging,
        }
        if (actual.enableLogging !== mode.expected.enableLogging
          || actual.enableDebugLogging !== mode.expected.enableDebugLogging) {
          wrong.push(`${name}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(mode.expected)}`)
        }
      })

      // Reported as one list rather than failing on the first, so a drifted copy
      // is seen alongside every other one rather than hiding behind it
      expect(wrong).toEqual([])
    })
  })

  it('has no handler drifting from the preamble that is not listed', () => {
    // The exceptions above are the whole list. A new one appearing means either
    // a fresh copy-paste slip or a deliberate change that belongs in that list
    // with its reason - either way it should not pass unnoticed.
    const unlisted = everyHandler()
      .filter(([name]) => !NO_LOGGING_FLAGS.has(name) && !KNOWN_EXCEPTIONS.has(name))
      .filter(([name, Handler]) => {
        const built = buildHandler(name, Handler, {
          config: { disableDeviceLogging: true },
          deviceConf: {},
        })
        return built.device?.enableLogging !== false || built.device?.enableDebugLogging !== false
      })
      .map(([name]) => name)

    expect(unlisted).toEqual([])
  })

  it('reads the override from the entry for this device, not another', () => {
    const [name, Handler] = handlers[0]

    const built = buildHandler(name, Handler, {
      config: { disableDeviceLogging: false },
      deviceConf: { someOtherDevice: { overrideLogging: 'disable' } },
      rfSubdevices: { someOtherDevice: { overrideLogging: 'disable' } },
    })

    // The lookup is keyed on this accessory's own device id, so a setting on a
    // different device must not reach it
    expect(built.device.enableLogging).toBe(true)
  })
})
