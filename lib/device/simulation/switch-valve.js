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

    // Add the switch service if it doesn't already exist
    this.sService = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Add the valve service if it doesn't already exist
    this.vService = this.accessory.getService(this.hapServ.Valve)
    if (!this.vService) {
      this.vService = this.accessory.addService(this.hapServ.Valve)
      this.vService.updateCharacteristic(this.hapChar.Active, 0)
      this.vService.updateCharacteristic(this.hapChar.InUse, 0)
      this.vService.updateCharacteristic(this.hapChar.ValveType, 1)
      this.vService.updateCharacteristic(this.hapChar.SetDuration, 120)
      this.vService.addCharacteristic(this.hapChar.RemainingDuration)
    }

    // Certain devices give power readings
    if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
      // Add Eve power characteristics
      this.powerReadings = true
      if (!this.sService.testCharacteristic(this.eveChar.CurrentConsumption)) {
        this.sService.addCharacteristic(this.eveChar.CurrentConsumption)
      }
      if (!this.vService.testCharacteristic(this.eveChar.CurrentConsumption)) {
        this.vService.addCharacteristic(this.eveChar.CurrentConsumption)
      }
      if (!this.sService.testCharacteristic(this.eveChar.ElectricCurrent)) {
        this.sService.addCharacteristic(this.eveChar.ElectricCurrent)
      }
      if (!this.vService.testCharacteristic(this.eveChar.ElectricCurrent)) {
        this.vService.addCharacteristic(this.eveChar.ElectricCurrent)
      }
      if (!this.sService.testCharacteristic(this.eveChar.Voltage)) {
        this.sService.addCharacteristic(this.eveChar.Voltage)
      }
      if (!this.vService.testCharacteristic(this.eveChar.Voltage)) {
        this.vService.addCharacteristic(this.eveChar.Voltage)
      }
    }

    // Add the set handler to the switch on/off characteristic
    this.sService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalSwitchUpdate(value))

    // Add the set handler to the valve active characteristic
    this.vService
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalValveUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.sService.getCharacteristic(this.hapChar.On).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.sService.getCharacteristic(this.hapChar.On).value
      })
      this.vService.getCharacteristic(this.hapChar.Active).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.vService.getCharacteristic(this.hapChar.Active).value
      })
    }

    // Add the set handler to the valve set duration characteristic
    this.vService.getCharacteristic(this.hapChar.SetDuration).onSet((value) => {
      // Check if the valve is currently active
      if (this.vService.getCharacteristic(this.hapChar.InUse).value === 1) {
        // Update the remaining duration characteristic with the new value
        this.vService.updateCharacteristic(this.hapChar.RemainingDuration, value)

        // Clear any existing active timers
        clearTimeout(this.timer)

        // Set a new active timer with the new time amount
        this.timer = setTimeout(
          () => this.vService.updateCharacteristic(this.hapChar.Active, 0),
          value * 1000,
        )
      }
    })

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, {
      log: () => {},
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
      showAs: 'switch_valve',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalSwitchUpdate(value) {
    try {
      const params = {
        switches: [
          {
            switch: value ? 'on' : 'off',
            outlet: 0,
          },
        ],
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = value ? 'on' : 'off'
      this.accessory.eveService.addEntry({ status: value ? 1 : 0 })
      if (this.enableLogging) {
        this.log('[%s] [switch] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.sService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalValveUpdate(value) {
    try {
      const params = {
        switches: [
          {
            switch: value ? 'on' : 'off',
            outlet: 1,
          },
        ],
      }
      this.vService.updateCharacteristic(this.hapChar.InUse, value)
      switch (value) {
        case 0:
          this.vService.updateCharacteristic(this.hapChar.RemainingDuration, 0)
          clearTimeout(this.timer)
          if (this.enableLogging) {
            this.log('[%s] [valve] %s [%s].', this.name, this.lang.curState, this.lang.valveNo)
          }
          break
        case 1: {
          const timer = this.vService.getCharacteristic(this.hapChar.SetDuration).value
          this.vService.updateCharacteristic(this.hapChar.RemainingDuration, timer)
          if (this.enableLogging) {
            this.log('[%s] [valve] %s [%s].', this.name, this.lang.curState, this.lang.valveYes)
          }
          this.timer = setTimeout(() => {
            this.vService.updateCharacteristic(this.hapChar.Active, 0)
          }, timer * 1000)
          break
        }
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.sService.updateCharacteristic(this.hapChar.Active, 0)
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
      if (params.switches?.length >= 2) {
        if (this.cacheState !== params.switches[0].switch) {
          this.cacheState = params.switches[0].switch
          this.sService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
          this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] [switch] %s [%s].', this.name, this.lang.curState, this.cacheState)
          }
        }
        if (params.switches[1].switch === 'on') {
          if (this.vService.getCharacteristic(this.hapChar.Active).value === 0) {
            const timer = this.vService.getCharacteristic(this.hapChar.SetDuration).value
            this.vService.updateCharacteristic(this.hapChar.Active, 1)
            this.vService.updateCharacteristic(this.hapChar.InUse, 1)
            this.vService.updateCharacteristic(this.hapChar.RemainingDuration, timer)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] [valve] %s [%s].', this.name, this.lang.curState, this.lang.valveYes)
            }
            this.timer = setTimeout(() => {
              this.vService.updateCharacteristic(this.hapChar.Active, 0)
            }, timer * 1000)
          }
        } else {
          this.vService.updateCharacteristic(this.hapChar.Active, 0)
          this.vService.updateCharacteristic(this.hapChar.InUse, 0)
          this.vService.updateCharacteristic(this.hapChar.RemainingDuration, 0)
          clearTimeout(this.timer)
        }
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
        this.sService.updateCharacteristic(this.eveChar.CurrentConsumption, power0)
        logger0 = true
      }
      if (hasProperty(params, 'actPow_01')) {
        power1 = Number.parseInt(params.actPow_01, 10) / 100
        this.vService.updateCharacteristic(this.eveChar.CurrentConsumption, power1)
        logger1 = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage0 = Number.parseInt(params.voltage_00, 10) / 100
        this.sService.updateCharacteristic(this.eveChar.Voltage, voltage0)
        logger0 = true
      }
      if (hasProperty(params, 'voltage_01')) {
        voltage1 = Number.parseInt(params.voltage_01, 10) / 100
        this.vService.updateCharacteristic(this.eveChar.Voltage, voltage1)
        logger1 = true
      }
      if (hasProperty(params, 'current_00')) {
        current0 = Number.parseInt(params.current_00, 10) / 100
        this.sService.updateCharacteristic(this.eveChar.ElectricCurrent, current0)
        logger0 = true
      }
      if (hasProperty(params, 'current_01')) {
        current1 = Number.parseInt(params.current_01, 10) / 100
        this.vService.updateCharacteristic(this.eveChar.ElectricCurrent, current1)
        logger1 = true
      }
      if (params.updateSource && this.enableLogging) {
        if (logger0) {
          this.log(
            '[%s] [switch] %s%s%s.',
            this.name,
            power0 !== undefined ? `${this.lang.curPower} [${power0}W]` : '',
            voltage0 !== undefined ? ` ${this.lang.curVolt} [${voltage0}V]` : '',
            current0 !== undefined ? ` ${this.lang.curCurr} [${current0}A]` : '',
          )
        }
        if (logger1) {
          this.log(
            '[%s] [valve] %s%s%s.',
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

  currentState() {
    return {
      services: ['switch', 'valve'],
      switch: {
        state: this.sService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
      },
      valve: {
        state: this.vService.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off',
      },
    }
  }

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
