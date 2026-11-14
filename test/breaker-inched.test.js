import { afterEach, describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'

/**
 * The circuit breaker (UIID 226) uses a boolean switch, `{ "switch": true }`,
 * where other single switches use 'on' and 'off'. The normal handlers already
 * did this; the inched ones sent 'on' and only reacted to 'on'.
 */

let cleanups = []

afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  cleanups = []
})

describe.each(['deviceSwitchSingleInched', 'deviceOutletSingleInched'])('%s on a circuit breaker', (name) => {
  function build() {
    const built = buildHandler(name, deviceTypes[name], {}, { eweUIID: 226 })
    cleanups.push(built.cleanup)
    expect(built.error).toBeUndefined()
    return built
  }

  it('sends the switch as true', async () => {
    const { device, platform } = build()

    await device.internalStateUpdate(true)

    expect(platform.sent.at(-1).params).toEqual({ switch: true })
  })

  it('follows a breaker that reports switch true', async () => {
    const { device, accessory } = build()
    const service = accessory.getService(name === 'deviceSwitchSingleInched'
      ? 'Switch'
      : 'Outlet')
    const before = service.getCharacteristic('On').value

    await device.externalUpdate({ switch: true })

    expect(service.getCharacteristic('On').value).toBe(!before)
  })
})
