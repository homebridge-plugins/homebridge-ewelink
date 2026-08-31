import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'
import { payloads } from './payloads.js'

/**
 * What a handler does with a message a real device actually sent.
 *
 * The snapshot next door records what each handler builds. This records what it
 * then does with what arrives, which is where the interesting mistakes live -
 * two devices on the same handler reporting the same reading in different
 * units, for instance.
 */

function feed(name, Handler, params, context = {}) {
  const built = buildHandler(name, Handler, {}, context)
  expect(built.error).toBeUndefined()
  return built
}

describe('the zigbee ambient sensor, on payloads from real devices', () => {
  const Handler = deviceTypes.zb.deviceSensorAmbient
  const name = 'zb.deviceSensorAmbient'

  it('reads hundredths of a degree from an AirGuard TH (#767)', async () => {
    const { device, accessory } = feed(name, Handler, payloads.airGuardTH.params)

    await device.externalUpdate(payloads.airGuardTH.params)

    // 2620 is 26.20 degrees
    expect(accessory.getService('TemperatureSensor')
      .getCharacteristic('CurrentTemperature').value).toBe(26.2)
  })

  it('reads degrees from an SNZB-02LD, which reports them with a decimal point (#701)', async () => {
    const { device, accessory } = feed(name, Handler, payloads.snzb02ld.params)

    await device.externalUpdate(payloads.snzb02ld.params)

    // "18.4" is already the temperature. Read as hundredths it became 0.18,
    // which is what an owner saw in HomeKit before this was pinned down.
    expect(accessory.getService('TemperatureSensor')
      .getCharacteristic('CurrentTemperature').value).toBe(18.4)
  })

  it('reads hundredths of a percent for humidity (#767)', async () => {
    const { device, accessory } = feed(name, Handler, payloads.airGuardTH.params)

    await device.externalUpdate(payloads.airGuardTH.params)

    // 4390 is 43.90 percent, cut to a whole number because that is all HomeKit
    // shows. Recorded as it stands: the value is truncated, not rounded.
    expect(accessory.getService('HumiditySensor')
      .getCharacteristic('CurrentRelativeHumidity').value).toBe(43)
  })

  it('carries the battery level across, and flags a low one', async () => {
    const { device, accessory } = feed(name, Handler, payloads.snzb02ld.params)

    await device.externalUpdate(payloads.snzb02ld.params)
    expect(accessory.getService('Battery').getCharacteristic('BatteryLevel').value).toBe(100)
    expect(accessory.getService('Battery').getCharacteristic('StatusLowBattery').value).toBe(0)

    await device.externalUpdate({ ...payloads.snzb02ld.params, battery: 5 })
    expect(accessory.getService('Battery').getCharacteristic('StatusLowBattery').value).toBe(1)
  })

  it('ignores a reading it cannot make sense of, rather than showing a wrong one', async () => {
    const { device, accessory } = feed(name, Handler, payloads.airGuardTH.params)

    await device.externalUpdate(payloads.airGuardTH.params)
    const good = accessory.getService('TemperatureSensor')
      .getCharacteristic('CurrentTemperature')
      .value

    await device.externalUpdate({ ...payloads.airGuardTH.params, temperature: 'not-a-number' })

    expect(accessory.getService('TemperatureSensor')
      .getCharacteristic('CurrentTemperature').value).toBe(good)
  })
})

describe('a power-reporting outlet, on payloads from a real device', () => {
  const Handler = deviceTypes.deviceOutletSingle
  const name = 'deviceOutletSingle'

  it('follows the switch state out of a multi-channel frame (#742)', async () => {
    // One outlet, but firmware that still reports a switches array. The handler
    // only reads that array for the UIIDs listed as multi-channel, so the test
    // has to build one of those - on any other UIID the frame is ignored, which
    // is what "not responding to state updates" looks like from outside.
    const { device, accessory } = feed(name, Handler, payloads.s60tpfOn.params, {
      eweUIID: payloads.s60tpfOn.uiid,
    })

    await device.externalUpdate(payloads.s60tpfOn.params)
    expect(accessory.getService('Outlet').getCharacteristic('On').value).toBe(true)

    await device.externalUpdate(payloads.s60tpfOff.params)
    expect(accessory.getService('Outlet').getCharacteristic('On').value).toBe(false)
  })
})

describe('the zigbee occupancy sensor, on a presence model', () => {
  const Handler = deviceTypes.zb.deviceSensorOccupancy
  const name = 'zb.deviceSensorOccupancy'
  const context = { eweUIID: payloads.snzb03pr2.uiid }

  it('reports occupancy from a live report that carries no timestamp', async () => {
    // The older occupancy model timestamps each report and the handler used to
    // insist on that, so a presence model's reports were dropped entirely
    const { device, accessory } = feed(name, Handler, payloads.snzb03pr2.params, context)

    await device.externalUpdate(payloads.snzb03pr2.params)
    expect(accessory.getService('OccupancySensor')
      .getCharacteristic('OccupancyDetected').value).toBe(true)

    await device.externalUpdate({ ...payloads.snzb03pr2.params, human: 0 })
    expect(accessory.getService('OccupancySensor')
      .getCharacteristic('OccupancyDetected').value).toBe(false)
  })

  it('shows the numeric light reading', async () => {
    const { device, accessory } = feed(name, Handler, payloads.snzb03pr2.params, context)

    await device.externalUpdate(payloads.snzb03pr2.params)
    expect(accessory.getService('LightSensor')
      .getCharacteristic('CurrentAmbientLightLevel').value).toBe(56)
  })

  it('keeps a zero light reading inside the range homekit accepts', async () => {
    const { device, accessory } = feed(name, Handler, payloads.snzb03pr2.params, context)

    await device.externalUpdate({ ...payloads.snzb03pr2.params, illumination: 0 })
    expect(accessory.getService('LightSensor')
      .getCharacteristic('CurrentAmbientLightLevel').value).toBe(0.0001)
  })

  it('carries the battery level across', async () => {
    const { device, accessory } = feed(name, Handler, payloads.snzb03pr2.params, context)

    await device.externalUpdate(payloads.snzb03pr2.params)
    expect(accessory.getService('Battery').getCharacteristic('BatteryLevel').value).toBe(92)
  })
})
