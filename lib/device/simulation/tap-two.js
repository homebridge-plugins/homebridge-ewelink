import platformConsts from '../../utils/constants.js'
import { hasProperty, sleep } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.accessory = accessory

    // Initially set the online flag as true (to be then updated as false if necessary)
    this.isOnline = true

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}

    // Set the correct logging variables for this accessory
    switch (deviceConf.overrideLogging) {
      case 'standard':
        this.enableLogging = true
        this.enableDebugLogging = false
        break
      case 'debug':
        this.enableLogging = true
        this.enableDebugLogging = true
        break
      case 'disable':
        this.enableLogging = false
        this.enableDebugLogging = false
        break
      default:
        this.enableLogging = !platform.config.disableDeviceLogging
        this.enableDebugLogging = platform.config.debug
        break
    }

    // Certain devices give power readings
    if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
      this.powerReadings = true
    }

    // We want two tap services for this accessory
    ['1', '2'].forEach((v) => {
      // Add the tap service if it doesn't already exist
      let tapService = this.accessory.getService(`Tap ${v}`)
      if (!tapService) {
        tapService = this.accessory.addService(this.hapServ.Valve, `Tap ${v}`, `tap${v}`)
        tapService.updateCharacteristic(this.hapChar.Active, 0)
        tapService.updateCharacteristic(this.hapChar.InUse, 0)
        tapService.updateCharacteristic(this.hapChar.ValveType, 3)
      }

      // Add Eve power characteristics
      if (this.powerReadings) {
        if (!tapService.testCharacteristic(this.eveChar.CurrentConsumption)) {
          tapService.addCharacteristic(this.eveChar.CurrentConsumption)
        }
        if (!tapService.testCharacteristic(this.eveChar.ElectricCurrent)) {
          tapService.addCharacteristic(this.eveChar.ElectricCurrent)
        }
        if (!tapService.testCharacteristic(this.eveChar.Voltage)) {
          tapService.addCharacteristic(this.eveChar.Voltage)
        }
      }

      // Add the set handler to the tap active characteristic
      tapService
        .getCharacteristic(this.hapChar.Active)
        .onSet(async value => this.internalUpdate(`Tap ${v}`, value))

      // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
      if (!platform.config.disableNoResponse) {
        tapService.getCharacteristic(this.hapChar.Active).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return tapService.getCharacteristic(this.hapChar.Active).value
        })
      }
    })

    // Set up an interval to get eWeLink to send power updates
    if (this.powerReadings && platform.config.mode !== 'lan') {
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'tap_two',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalUpdate(tap, value) {
    try {
      const params = {
        switches: [],
      }
      const tapService = this.accessory.getService(tap)
      switch (tap) {
        case 'Tap 1':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 0 })
          break
        case 'Tap 2':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 1 })
          break
        default:
          return
      }
      tapService.updateCharacteristic(this.hapChar.InUse, value)
      if (this.enableLogging) {
        this.log(
          '[%s] [%s] %s [%s].',
          this.name,
          tap,
          this.lang.curState,
          value === 1 ? this.lang.valveYes : this.lang.valveNo,
        )
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      const tapService = this.accessory.getService(tap)
      setTimeout(() => {
        tapService.updateCharacteristic(this.hapChar.Active, value === 1 ? 0 : 1)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalUIUpdate() {
    try {
      // Skip polling if device isn't online
      if (!this.isOnline) {
        return
      }

      // Send the params to request the updates
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 0, time: 120 } })
      await sleep(2000)
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 1, time: 120 } })
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (params.switches) {
        ['1', '2'].forEach((v, k) => {
          const tapService = this.accessory.getService(`Tap ${v}`)
          tapService.updateCharacteristic(
            this.hapChar.Active,
            params.switches[k].switch === 'on' ? 1 : 0,
          )
          tapService.updateCharacteristic(
            this.hapChar.InUse,
            params.switches[k].switch === 'on' ? 1 : 0,
          )
          if (params.updateSource && this.enableLogging) {
            this.log(
              '[%s] [Tap %s] %s [%s].',
              this.name,
              v,
              this.lang.curState,
              params.switches[k].switch === 'on' ? this.lang.valveYes : this.lang.valveNo,
            )
          }
        })
      }

      // Get the power readings given by certain devices
      if (!this.powerReadings) {
        return
      }
      let logger0 = false
      let logger1 = false
      let power0
      let power1
      let voltage0
      let voltage1
      let current0
      let current1
      if (hasProperty(params, 'actPow_00')) {
        power0 = Number.parseInt(params.actPow_00, 10) / 100
        this.accessory
          .getService('Tap 1')
          .updateCharacteristic(this.eveChar.CurrentConsumption, power0)
        logger0 = true
      }
      if (hasProperty(params, 'actPow_01')) {
        power1 = Number.parseInt(params.actPow_01, 10) / 100
        this.accessory
          .getService('Tap 2')
          .updateCharacteristic(this.eveChar.CurrentConsumption, power1)
        logger1 = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage0 = Number.parseInt(params.voltage_00, 10) / 100
        this.accessory.getService('Tap 1').updateCharacteristic(this.eveChar.Voltage, voltage0)
        logger0 = true
      }
      if (hasProperty(params, 'voltage_01')) {
        voltage1 = Number.parseInt(params.voltage_01, 10) / 100
        this.accessory.getService('Tap 2').updateCharacteristic(this.eveChar.Voltage, voltage1)
        logger1 = true
      }
      if (hasProperty(params, 'current_00')) {
        current0 = Number.parseInt(params.current_00, 10) / 100
        this.accessory
          .getService('Tap 1')
          .updateCharacteristic(this.eveChar.ElectricCurrent, current0)
        logger0 = true
      }
      if (hasProperty(params, 'current_01')) {
        current1 = Number.parseInt(params.current_01, 10) / 100
        this.accessory
          .getService('Tap 2')
          .updateCharacteristic(this.eveChar.ElectricCurrent, current1)
        logger1 = true
      }
      if (params.updateSource && this.enableLogging) {
        if (logger0) {
          this.log(
            '[%s] [Tap 1] %s%s%s.',
            this.name,
            power0 !== undefined ? `${this.lang.curPower} [${power0}W]` : '',
            voltage0 !== undefined ? ` ${this.lang.curVolt} [${voltage0}V]` : '',
            current0 !== undefined ? ` ${this.lang.curCurr} [${current0}A]` : '',
          )
        }
        if (logger1) {
          this.log(
            '[%s] [Tap 2] %s%s%s.',
            this.name,
            power1 !== undefined ? `${this.lang.curPower} [${power1}W]` : '',
            voltage1 !== undefined ? ` ${this.lang.curVolt} [${voltage1}V]` : '',
            current1 !== undefined ? ` ${this.lang.curCurr} [${current1}A]` : '',
          )
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
