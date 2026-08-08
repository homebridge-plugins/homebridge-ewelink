/**
 * Real device payloads, taken from what owners pasted into closed issues.
 *
 * Invented fixtures agree with whatever the code already assumes, so they only
 * ever confirm the current reading of a device. These came off real hardware,
 * which is why they disagree with each other - see the two temperature formats
 * below.
 *
 * Every identifier is replaced: device ids, sub-device ids, parent ids, MAC
 * addresses and API keys are not ours to keep, and none of them changes how a
 * payload is parsed. The values that matter - readings, switch states, units -
 * are exactly as reported.
 *
 * Each entry names the issue it came from, so the device behind it can be
 * checked again later.
 */

/** Stand-in identifiers, so no real device is recorded here. */
const DEVICE_ID = '10001abcde'
const SUB_DEVICE_ID = 'ffff000000000000aaaa'

export const payloads = {
  /**
   * SONOFF SNZB-02LD, a Zigbee temperature sensor on UIID 7033.
   *
   * Reports the degrees themselves, as a string with a decimal point. Issue
   * #701. This is the odd one out - see airGuardTH below.
   */
  snzb02ld: {
    issue: 701,
    uiid: 7033,
    params: {
      battery: 100,
      fwVersion: '1.1.0',
      parentid: DEVICE_ID,
      subDevId: SUB_DEVICE_ID,
      subDevRssi: -69,
      subDeviceManufacturer: 'SONOFF',
      supportPowConfig: 1,
      tempCorrection: '0.0',
      tempUnit: 0,
      temperature: '18.4',
      temperatureF: '65.1',
      trigTime: '1761310540000',
      updateSource: 'LAN',
    },
  },

  /**
   * SONOFF AirGuard TH, on the same handler as the sensor above.
   *
   * Reports hundredths of a unit as an integer: 2620 is 26.20 degrees, 4390 is
   * 43.90 percent. Issue #767.
   */
  airGuardTH: {
    issue: 767,
    uiid: 7033,
    params: {
      battery: 100,
      frequentMode: false,
      fwVersion: '1.0.4',
      humCorrection: 0,
      humidity: 4390,
      humidityAvg: 4657,
      humidityMax: 4990,
      humidityMin: 4090,
      parentid: DEVICE_ID,
      subDevId: SUB_DEVICE_ID,
      subDevRssi: -56,
      temperature: 2620,
      updateSource: 'LAN',
    },
  },

  /**
   * SONOFF S60TPF, a single outlet reporting its own power use.
   *
   * The three shapes an owner saw over LAN while switching it. Issue #742.
   */
  s60tpfOn: {
    issue: 742,
    // A power-reporting outlet whose firmware speaks the multi-channel format,
    // which is what makes the handler read the switches array at all
    uiid: 7032,
    params: {
      current: 0,
      online: true,
      power: 0,
      switches: [{ outlet: 0, switch: 'on' }],
      updateSource: 'LAN',
      voltage: 0,
    },
  },
  s60tpfOff: {
    issue: 742,
    uiid: 7032,
    params: {
      current: 0,
      online: true,
      power: 0,
      switches: [{ outlet: 0, switch: 'off' }],
      updateSource: 'LAN',
      voltage: 0,
    },
  },
}
