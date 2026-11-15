import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The SwitchMan R5 has six buttons on one accessory. Home needs a ServiceLabel
 * service to number them, or an automation set on a button is never saved
 * (#820).
 */

const name = 'deviceSwitchMan'

describe('the SwitchMan R5', () => {
  it('has a ServiceLabel service for its six numbered buttons', () => {
    const { accessory, cleanup, error } = buildHandler(name, deviceTypes[name], {}, { eweUIID: 174 })
    cleanup()
    expect(error).toBeUndefined()
    expect(accessory.services.filter(service => service.type === 'StatelessProgrammableSwitch')).toHaveLength(6)
    expect(accessory.services.filter(service => service.type === 'ServiceLabel')).toHaveLength(1)
  })

  it('adds the ServiceLabel service to an accessory made before it existed', () => {
    const first = buildHandler(name, deviceTypes[name], {}, { eweUIID: 174 })
    first.cleanup()
    // An accessory from the cache: the buttons are there, the label service is not
    first.accessory.removeService(first.accessory.getService('ServiceLabel'))
    const device = new deviceTypes[name](first.platform, first.accessory)
    expect(device).toBeDefined()
    expect(first.accessory.services.filter(service => service.type === 'ServiceLabel')).toHaveLength(1)
    expect(first.accessory.services.filter(service => service.type === 'StatelessProgrammableSwitch')).toHaveLength(6)
  })

  it('logs a press with the button name', async () => {
    const { device, platform, cleanup } = buildHandler(name, deviceTypes[name], {}, { eweUIID: 174 })
    await device.externalUpdate({
      outlet: 0,
      key: 0,
      actionTime: Date.now(),
      updateSource: 'WS',
    })
    cleanup()
    const line = platform.log.entries.find(entry => entry.args[3] === platform.lang.curState)
    expect(line.args[2]).toBe('Channel 1')
  })
})
