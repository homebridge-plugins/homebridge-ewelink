import { describe, expect, it } from 'vitest'

import Platform from '../lib/platform.js'
import EveChars from '../lib/utils/eve-chars.js'

/**
 * Just enough of HAP to build the Eve characteristics and look at their props.
 * Real HAP rounds a uint16 value, so 5.49W is published as 5W - the props are
 * what decide that, so the props are what these tests check.
 */
class FakeCharacteristic {
  constructor(displayName, UUID, props = {}) {
    this.displayName = displayName
    this.UUID = UUID
    this.props = { ...props }
  }

  setProps(props) {
    Object.assign(this.props, props)
    return this
  }

  getDefaultValue() {
    return 0
  }
}

const hap = {
  Characteristic: FakeCharacteristic,
  Formats: {
    FLOAT: 'float',
    UINT16: 'uint16',
    UINT8: 'uint8',
    UINT32: 'uint32',
  },
  Perms: { PAIRED_READ: 'pr', PAIRED_WRITE: 'pw', NOTIFY: 'ev' },
  Units: { SECONDS: 'seconds' },
}

const eveChars = new EveChars({ hap })

describe('the eve current consumption characteristic', () => {
  it('is decimal, so 5.5W is not shown as 6W', () => {
    const characteristic = new eveChars.CurrentConsumption()

    expect(characteristic.props).toMatchObject({ format: 'float', minStep: 0.01, unit: 'W' })
  })

  it('is switched to decimal on an accessory restored from the cache', () => {
    // How an accessory added before this change comes back from Homebridge's
    // cache: with the whole-watt props it was saved with
    const cached = new FakeCharacteristic('Current Consumption', eveChars.uuids.currentConsumption, {
      format: 'uint16',
      unit: 'W',
      minStep: 1,
    })
    const other = new FakeCharacteristic('Total Consumption', eveChars.uuids.totalConsumption, {
      format: 'float',
      minStep: 0.01,
    })
    const accessory = {
      context: {},
      services: [
        {
          characteristics: [cached, other],
        },
      ],
    }

    // Built with no arguments, the platform skips its set-up, so only the
    // cache restore runs. Homebridge calls this before the plugin launches.
    const platform = new Platform()
    platform.api = { hap }
    platform.configureAccessory(accessory)

    expect(cached.props).toMatchObject({ format: 'float', minStep: 0.01, unit: 'W' })
    expect(other.props).toEqual({ format: 'float', minStep: 0.01 })
  })
})
