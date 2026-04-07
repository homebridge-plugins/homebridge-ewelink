import platformConsts from '../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../utils/functions.js'

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

    /*
      This is for the DUALR3 using motor mode
      This device's parameters are:
      motorTurn: 1=OPEN, 0=STOP, 2=CLOSE (not needed by plugin)
      location: 0=CLOSED, 100=OPEN
      currLocation: 0=CLOSED, 100=OPEN
    */

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
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
        this.enableDebugLogging = platform.config.debug
        break
    }

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

    // Add Eve power characteristics
    if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
      this.service.addCharacteristic(this.eveChar.CurrentConsumption)
    }
    if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
      this.service.addCharacteristic(this.eveChar.ElectricCurrent)
    }
    if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
      this.service.addCharacteristic(this.eveChar.Voltage)
    }

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

    if (platform.config.mode !== 'lan') {
      // Set up an interval to get eWeLink to send power updates
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)

      // Stop the intervals on Homebridge shutdown
      platform.api.on('shutdown', () => clearInterval(this.intervalPoll))
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
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
      const params = this.accessory.context.eweUIID === 211
        ? { percentageControl: 100 - value }
        : { location: value }
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

      const params = this.accessory.context.eweUIID === 211
        ? { electromotor: value === 1 ? 2 : 0 }
        : { location: value === 1 ? 0 : 100 }
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

  async internalUIUpdate() {
    try {
      // Skip polling if device isn't online
      if (!this.isOnline) {
        return
      }

      // Send the params to request the updates
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 0, time: 120 } })
    } catch (err) {
      this.log.error(err)
    }
  }

  async externalUpdate(params) {
    try {
      let locationParams = false

      // T5 cover uses percentageControl (inverted: 0=open, 100=closed)
      if (hasProperty(params, 'percentageControl') && params.calibState) {
        locationParams = true
        const newPos = Math.max(Math.min(100 - params.percentageControl, 100), 0)
        if (newPos !== this.cachePos) {
          this.cachePos = newPos
          if (!this.isGarage) {
            this.service.updateCharacteristic(this.hapChar.CurrentPosition, this.cachePos)
            this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cachePos)
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curPos, this.cachePos)
          }
        }
      }

      // currLocation is the current position of the motor
      if (hasProperty(params, 'currLocation')) {
        locationParams = true
        if (params.currLocation !== this.cachePos) {
          this.cachePos = Math.max(Math.min(params.currLocation, 100), 0)
          if (!this.isGarage) {
            this.service.updateCharacteristic(this.hapChar.CurrentPosition, this.cachePos)
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curPos, this.cachePos)
          }
        }
      }

      // location is the target position of the motor
      if (hasProperty(params, 'location')) {
        locationParams = true
        if (params.location !== this.cacheTarg) {
          this.cacheTarg = params.location
          if (!this.isGarage) {
            this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curTarg, this.cacheTarg)
          }
        }
      }

      if (locationParams) {
        // Get the target door state characteristic for use later
        const targetChar = this.isGarage
          ? this.service.getCharacteristic(this.hapChar.TargetDoorState)
          : this.service.getCharacteristic(this.hapChar.TargetPosition)

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
      }

      // Update power information if given
      let logger = false
      let power
      let voltage
      let current
      if (hasProperty(params, 'actPow_00')) {
        power = Number.parseInt(params.actPow_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        logger = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage = Number.parseInt(params.voltage_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.Voltage, voltage)
        logger = true
      }
      if (hasProperty(params, 'current_00')) {
        current = Number.parseInt(params.current_00, 10) / 100
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
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
