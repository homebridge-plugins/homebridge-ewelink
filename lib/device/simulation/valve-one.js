import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

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
    this.disableTimer = deviceConf.disableTimer

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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the valve service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Valve)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.Valve)
      this.service.updateCharacteristic(this.hapChar.Active, 0)
      this.service.updateCharacteristic(this.hapChar.InUse, 0)
      this.service.updateCharacteristic(this.hapChar.ValveType, 1)
      this.service.updateCharacteristic(this.hapChar.SetDuration, 120)
      this.service.addCharacteristic(this.hapChar.RemainingDuration)
    }

    // Set up the device type and power readings if necessary
    if (platformConsts.devices.switchSingle.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchSingle'
    } else if (platformConsts.devices.switchSinglePower.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchSingle'

      // Add Eve power characteristics
      this.powerReadings = true
      if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
        this.service.addCharacteristic(this.eveChar.CurrentConsumption)
      }
      if (this.accessory.context.eweUIID === 32) {
        if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
          this.service.addCharacteristic(this.eveChar.ElectricCurrent)
        }
        if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.addCharacteristic(this.eveChar.Voltage)
        }
      }
    } else if (platformConsts.devices.switchMulti.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchMulti'
      if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
        // Add Eve power characteristics
        this.powerReadings = true
        if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
          this.service.addCharacteristic(this.eveChar.CurrentConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
          this.service.addCharacteristic(this.eveChar.ElectricCurrent)
        }
        if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.addCharacteristic(this.eveChar.Voltage)
        }
        this.isDualR3 = true
      }
    } else if (platformConsts.devices.switchSCM.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchMulti'
    } else if (platformConsts.devices.switchSCMPower.includes(this.accessory.context.eweUIID)) {
      // Could do power here
      this.setup = 'switchMulti'
    }

    // Add the set handler to the valve active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.Active).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.Active).value
      })
    }

    // Add the set handler to the valve set duration characteristic
    if (this.disableTimer) {
      if (this.service.testCharacteristic(this.hapChar.SetDuration)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.SetDuration))
      }
      if (this.service.testCharacteristic(this.hapChar.RemainingDuration)) {
        this.service.removeCharacteristic(
          this.service.getCharacteristic(this.hapChar.RemainingDuration),
        )
      }
    } else {
      this.service.getCharacteristic(this.hapChar.SetDuration).onSet((value) => {
        // Check if the valve is currently active
        if (this.service.getCharacteristic(this.hapChar.InUse).value === 1) {
          // Update the remaining duration characteristic with the new value
          this.service.updateCharacteristic(this.hapChar.RemainingDuration, value)

          // Clear any existing active timers
          clearTimeout(this.timer)

          // Set a new active timer with the new time amount
          this.timer = setTimeout(
            () => this.service.setCharacteristic(this.hapChar.Active, 0),
            value * 1000,
          )
        }
      })
    }

    // Set up an interval to get eWeLink to send power updates
    if (
      this.powerReadings
      && (!this.isDualR3 || (this.isDualR3 && platform.config.mode !== 'lan'))
    ) {
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      disableTimer: this.disableTimer,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'valve',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalUpdate(value) {
    try {
      const params = {}
      switch (this.setup) {
        case 'switchSingle':
          params.switch = value ? 'on' : 'off'
          break
        case 'switchMulti':
          params.switches = [
            {
              switch: value ? 'on' : 'off',
              outlet: 0,
            },
          ]
          break
        default:
          return
      }
      this.service.updateCharacteristic(this.hapChar.InUse, value)
      switch (value) {
        case 0:
          if (!this.disableTimer) {
            this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
            clearTimeout(this.timer)
          }
          if (this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.valveNo)
          }
          break
        case 1: {
          if (!this.disableTimer) {
            const timer = this.service.getCharacteristic(this.hapChar.SetDuration).value
            this.service.updateCharacteristic(this.hapChar.RemainingDuration, timer)
            this.timer = setTimeout(() => {
              this.service.setCharacteristic(this.hapChar.Active, 0)
            }, timer * 1000)
          }
          if (this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.valveYes)
          }
          break
        }
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, value === 1 ? 0 : 1)
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
      if (this.isDualR3) {
        await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 0, time: 120 } })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, { uiActive: 120 })
      }
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (
        (this.setup === 'switchMulti' && params.switches)
        || (this.setup === 'switchSingle' && params.switch)
      ) {
        let newState
        if (this.setup === 'switchMulti' && params.switches) {
          newState = params.switches[0].switch
        } else if (this.setup === 'switchSingle' && params.switch) {
          newState = params.switch
        }
        if (newState === 'on') {
          if (this.service.getCharacteristic(this.hapChar.Active).value === 0) {
            this.service.updateCharacteristic(this.hapChar.Active, 1)
            this.service.updateCharacteristic(this.hapChar.InUse, 1)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.valveYes)
            }
            if (!this.disableTimer) {
              const timer = this.service.getCharacteristic(this.hapChar.SetDuration).value
              this.service.updateCharacteristic(this.hapChar.RemainingDuration, timer)
              this.timer = setTimeout(() => {
                this.service.setCharacteristic(this.hapChar.Active, 0)
              }, timer * 1000)
            }
          }
        } else if (this.service.getCharacteristic(this.hapChar.Active).value === 1) {
          this.service.updateCharacteristic(this.hapChar.Active, 0)
          this.service.updateCharacteristic(this.hapChar.InUse, 0)
          if (!this.disableTimer) {
            this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
            clearTimeout(this.timer)
          } else if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.valveNo)
          }
        }
      }

      // Get the power readings given by certain devices
      if (!this.powerReadings) {
        return
      }
      let logger = false
      let power
      let voltage
      let current
      if (hasProperty(params, 'actPow_00')) {
        power = Number.parseInt(params.actPow_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        logger = true
      } else if (hasProperty(params, 'power')) {
        power = Number.parseFloat(params.power)
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        logger = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage = Number.parseInt(params.voltage_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.Voltage, voltage)
        logger = true
      } else if (hasProperty(params, 'voltage')) {
        voltage = Number.parseFloat(params.voltage)
        this.service.updateCharacteristic(this.eveChar.Voltage, voltage)
        logger = true
      }
      if (hasProperty(params, 'current_00')) {
        current = Number.parseInt(params.current_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.ElectricCurrent, current)
        logger = true
      } else if (hasProperty(params, 'current')) {
        current = Number.parseFloat(params.current)
        this.service.updateCharacteristic(this.eveChar.ElectricCurrent, current)
        logger = true
      }
      if (params.updateSource && logger && this.enableLogging) {
        this.log(
          '[%s] %s%s%s.',
          this.name,
          power !== undefined ? `${this.lang.curPower} [${power}W]` : '',
          voltage !== undefined ? ` ${this.lang.curVolt} [${voltage}V]` : '',
          current !== undefined ? ` ${this.lang.curCurr} [${current}A]` : '',
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  currentState() {
    return {
      services: ['valve'],
      valve: {
        state: this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off',
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
