import platformConsts from '../../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.lowBattThreshold = deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold
    const showAsMotor = deviceConf.showAsMotor || platformConsts.defaultValues.showAsMotor

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
        this.enableDebugLogging = false
        break
    }

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Add the window covering service if it doesn't already exist
    let service
    switch (showAsMotor) {
      case 'door':
        service = this.hapServ.Door
        if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
        }
        if (this.accessory.getService(this.hapServ.Window)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
        }
        if (this.accessory.getService(this.hapServ.WindowCovering)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
        }
        break
      case 'garage':
        service = this.hapServ.GarageDoorOpener
        this.isGarage = true
        if (this.accessory.getService(this.hapServ.Door)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
        }
        if (this.accessory.getService(this.hapServ.Window)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
        }
        if (this.accessory.getService(this.hapServ.WindowCovering)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
        }
        break
      case 'window':
        service = this.hapServ.Window
        if (this.accessory.getService(this.hapServ.Door)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
        }
        if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
        }
        if (this.accessory.getService(this.hapServ.WindowCovering)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
        }
        break
      default:
        service = this.hapServ.WindowCovering
        if (this.accessory.getService(this.hapServ.Door)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
        }
        if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
        }
        if (this.accessory.getService(this.hapServ.Window)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
        }
        break
    }
    this.service = this.accessory.getService(service) || this.accessory.addService(service)

    // Add the set handler to the target position characteristic
    if (this.isGarage) {
      this.service
        .getCharacteristic(this.hapChar.TargetDoorState)
        .onSet(async value => this.internalTargetUpdate(value))
    } else {
      this.service
        .getCharacteristic(this.hapChar.TargetPosition)
        .onSet(async value => this.internalPositionUpdate(value))
    }

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      if (this.isGarage) {
        this.service.getCharacteristic(this.hapChar.CurrentDoorState).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
        })
        this.service.getCharacteristic(this.hapChar.TargetDoorState).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.TargetDoorState).value
        })
      } else {
        this.service.getCharacteristic(this.hapChar.CurrentPosition).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.CurrentPosition).value
        })
        this.service.getCharacteristic(this.hapChar.TargetPosition).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.TargetPosition).value
        })
      }
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      lowBattThreshold: this.lowBattThreshold,
      showAsMotor,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalPositionUpdate(value) {
    try {
      if (this.cachePos === value) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }
      const params = { openPercent: value }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheTarg = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curTarg, this.cacheTarg)
      }
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      // 0 for open, 1 for closed
      // this.cachePos is 0 for closed and >0 for open

      const params = { openPercent: value === 1 ? 0 : 100 }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheTarg = value === 1 ? 0 : 100
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curTarg, this.cacheTarg)
      }
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (hasProperty(params, 'battery') && params.battery !== this.cacheBatt) {
        this.cacheBatt = params.battery
        this.cacheBattScaled = Math.max(Math.min(this.cacheBatt, 100), 0)
        this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBattScaled)
        this.battService.updateCharacteristic(
          this.hapChar.StatusLowBattery,
          this.cacheBattScaled < this.lowBattThreshold ? 1 : 0,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s%].', this.name, this.lang.curBatt, this.cacheBattScaled)
        }
      }

      // currLocation is the current position of the motor
      if (hasProperty(params, 'curPercen')) {
        if (params.curPercen !== this.cachePos) {
          this.cachePos = params.curPercen
          if (!this.isGarage) {
            this.service.updateCharacteristic(this.hapChar.CurrentPosition, this.cachePos)
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curPos, this.cachePos)
          }
        }
      }

      // location is the target position of the motor
      if (hasProperty(params, 'openPercent')) {
        if (params.openPercent !== this.cacheTarg) {
          this.cacheTarg = params.openPercent
          if (!this.isGarage) {
            this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curTarg, this.cacheTarg)
          }
        }
      }

      // Get the target door state characteristic for use later
      let targetChar
      if (this.isGarage) {
        targetChar = this.service.getCharacteristic(this.TargetDoorState)
      }

      // If the two are equal then the motor must have stopped at this position
      if (this.cacheTarg === this.cachePos) {
        if (this.isGarage) {
          if (this.cachePos === 0) {
            // CLOSED
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            if (targetChar.value !== 1) {
              targetChar.updateValue(1)
            }
          } else {
            // OPEN
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            if (targetChar.value !== 0) {
              targetChar.updateValue(0)
            }
          }
        } else {
          // PositionState 2 === STOPPED
          this.service.updateCharacteristic(this.hapChar.PositionState, 2)
        }
      } else if (this.cacheTarg > this.cachePos) {
        if (this.isGarage) {
          // OPENING
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 2)
          if (targetChar.value !== 0) {
            targetChar.updateValue(0)
          }
        } else {
          // PositionState 1 === INCREASING
          this.service.updateCharacteristic(this.hapChar.PositionState, 1)
        }
      } else if (this.isGarage) {
        // CLOSING
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 3)
        if (targetChar.value !== 1) {
          targetChar.updateValue(1)
        }
      } else {
        // PositionState 0 === DECREASING
        this.service.updateCharacteristic(this.hapChar.PositionState, 0)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
