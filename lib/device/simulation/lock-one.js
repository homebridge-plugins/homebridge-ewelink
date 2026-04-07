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
    this.operationTime = deviceConf.operationTime || platformConsts.defaultValues.operationTime
    this.isManual = this.operationTime === 0

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

    // Check the sensor is valid if defined by the user
    if (deviceConf.sensorId) {
      this.definedSensor = true
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the lock service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.LockMechanism)
      || this.accessory.addService(this.hapServ.LockMechanism)

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

    // Add the set handler to the lock target state characteristic
    this.service.getCharacteristic(this.hapChar.LockTargetState).onSet(async (value) => {
      if (this.isManual) {
        await this.internalManualUpdate(value)
      } else {
        // We don't use await as we want the callback to be run straight away
        this.internalTimedUpdate(value)
      }
    })

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.LockCurrentState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.LockCurrentState).value
      })
      this.service.getCharacteristic(this.hapChar.LockTargetState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.LockTargetState).value
      })
    }

    // Always show the accessory as locked on Homebridge restart
    this.service
      .updateCharacteristic(this.hapChar.LockCurrentState, 1)
      .updateCharacteristic(this.hapChar.LockTargetState, 1)
    this.accessory.context.contactDetected = true

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
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      operationTime: this.operationTime,
      showAs: 'lock',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalTimedUpdate(value) {
    try {
      if (value === 1) {
        this.service.updateCharacteristic(this.hapChar.LockCurrentState, 1)
        return
      }

      // This model may need a close command before opening again
      if (this.accessory.context.eweModel === '0185') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          switch: 'off',
        })
        await sleep(500)
      }

      const params = {}
      switch (this.setup) {
        case 'switchSingle':
          params.switch = 'on'
          break
        case 'switchMulti':
          params.switches = [
            {
              switch: 'on',
              outlet: 0,
            },
          ]
          break
        default:
          return
      }
      this.inUse = true
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.service.updateCharacteristic(this.hapChar.LockCurrentState, 0)
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.lockUnlocked)
      }
      if (this.definedSensor) {
        this.internalSensorCheck()
        return
      }
      await sleep(Math.max(this.operationTime * 100, 1000))
      this.service.updateCharacteristic(this.hapChar.LockTargetState, 1)
      this.service.updateCharacteristic(this.hapChar.LockCurrentState, 1)
      this.inUse = false
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.lockLocked)
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.LockTargetState, 1)
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.LockTargetState, new this.hapErr(-70402))
    }
  }

  async internalManualUpdate(value) {
    try {
      const newValue = value === 1 ? 'off' : 'on'
      const newLang = value === 1 ? this.lang.lockLocked : this.lang.lockUnlocked

      const params = {}
      switch (this.setup) {
        case 'switchSingle':
          params.switch = newValue
          break
        case 'switchMulti':
          params.switches = [
            {
              switch: newValue,
              outlet: 0,
            },
          ]
          break
        default:
          return
      }

      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, newLang)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.LockTargetState, 1)
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.LockTargetState, new this.hapErr(-70402))
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

  internalSensorCheck() {
    if (this.timeoutInterval) {
      clearTimeout(this.timeoutInterval)
    }
    this.timeoutInterval = setTimeout(() => {
      if (this.accessory.context.contactDetected) {
        this.service.updateCharacteristic(this.hapChar.LockCurrentState, 1)
        this.service.updateCharacteristic(this.hapChar.LockTargetState, 1)
        this.inUse = false
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.lockLocked)
        }
      }
    }, this.operationTime * 100 + 50)
  }

  async externalUpdate(params) {
    try {
      if (!this.inUse && !this.isManual) {
        if (
          (this.setup === 'switchMulti' && params.switches && params.switches[0].switch === 'on')
          || (this.setup === 'switchSingle' && params.switch && params.switch === 'on')
        ) {
          if (this.definedSensor) {
            this.internalSensorCheck()
          } else {
            this.inUse = true
            this.service.updateCharacteristic(this.hapChar.LockCurrentState, 0)
            this.service.updateCharacteristic(this.hapChar.LockTargetState, 0)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.lockUnlocked)
            }
            await sleep(Math.max(this.operationTime * 100, 1000))
            this.service.updateCharacteristic(this.hapChar.LockCurrentState, 1)
            this.service.updateCharacteristic(this.hapChar.LockTargetState, 1)
            this.inUse = false
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.lockLocked)
            }
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
      this.inUse = false
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
