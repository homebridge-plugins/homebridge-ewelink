import platformConsts from '../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../utils/functions.js'

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

    // Initially set the online flag as true (to be then updated as false if necessary)
    this.isOnline = true

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
      showAsMotor,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    /*
      Q1
        {"op":3} -> command to close
        {"op":3,"per":0} -> received when closed

        {"op":1,} -> command to open
        {"op":1,"per":100} -> received when open
    */
  }

  async internalPositionUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the slider
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }

      // Create the params object to send
      const params = {}

      // Mid-movement stop: if target is within 5% of current, send stop
      if (Math.abs(value - this.cachePos) <= 5 && value !== 0 && value !== 100) {
        switch (this.accessory.context.eweUIID) {
          case 11:
            params.switch = 'pause'
            break
          case 67:
            params.op = 2
            break
          default:
            return
        }
        await this.platform.sendDeviceUpdate(this.accessory, params)
        return
      }

      switch (this.accessory.context.eweUIID) {
        case 11:
          // If we are to fully open/close the curtain we can use the switch param
          if ([0, 100].includes(value)) {
            // 'on' for fully open and 'off' for fully close
            params.switch = value === 100 ? 'on' : 'off'
          } else {
            // Otherwise, for a %-point we can use the 'setclose' param
            params.setclose = Math.abs(100 - value)
          }
          break
        case 67:
          // For a %-point we can use the 'per' param int[0=CLOSED, 100=OPEN]
          params.per = value
          break
        default:
          return
      }

      // Send the device update
      await this.platform.sendDeviceUpdate(this.accessory, params)

      // Update the cache with the new position
      this.cachePos = value

      // Log the update if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curPos, this.cachePos)
      }
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cachePos)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      // value is 0 for open and 1 for closed
      const params = {}
      switch (this.accessory.context.eweUIID) {
        case 11:
          params.switch = value === 0 ? 'on' : 'off'
          break
        case 67:
          params.op = value === 0 ? 1 : 3
          break
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.cachePos)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      // Don't continue if there are no useful parameters
      if (this.isGarage) {
        switch (this.accessory.context.eweUIID) {
          case 11:
            // Todo
            break
          case 67:
            if (hasProperty(params, 'op') && hasProperty(params, 'per')) {
              if (params.op === 3 && params.per === 0) {
                // closed
                if (this.cachePos !== 1) {
                  this.cachePos = 1
                  this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
                  this.service.updateCharacteristic(this.hapChar.TargetDoorState, 1)
                  if (params.updateSource && this.enableLogging) {
                    this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.doorClosed)
                  }
                }
              } else if (params.op === 1 && params.per === 100) {
                // open
                if (this.cachePos !== 0) {
                  this.cachePos = 0
                  this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
                  this.service.updateCharacteristic(this.hapChar.TargetDoorState, 0)
                  if (params.updateSource && this.enableLogging) {
                    this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.doorOpen)
                  }
                }
              }
            }
            break
          default:
        }
      } else if (
        params.switch
        || hasProperty(params, 'setclose')
        || hasProperty(params, 'per')
      ) {
        let newPos
        switch (this.accessory.context.eweUIID) {
          case 11:
            // 'setclose' is 0=OPEN 100=CLOSED whereas HomeKit is 0=CLOSED 100=OPEN
            // 'switch' is 'on' for fully open and 'off' for fully close
            if (hasProperty(params, 'setclose')) {
              newPos = Math.abs(100 - params.setclose)
            } else if (params.switch) {
              newPos = params.switch === 'on' ? 100 : 0
            } else {
              return
            }
            break
          case 67:
            // 'per' matches HomeKit status 0=CLOSED 100=OPEN
            if (hasProperty(params, 'per')) {
              newPos = params.per
            } else {
              return
            }
            break
          default:
            return
        }

        // Update HomeKit with the provided value
        this.service.updateCharacteristic(this.hapChar.TargetPosition, newPos)
        this.service.updateCharacteristic(this.hapChar.CurrentPosition, newPos)
        this.service.updateCharacteristic(this.hapChar.PositionState, 2)

        // Only update the cache and log if the provided value has changed
        if (params.updateSource && this.cachePos !== newPos) {
          this.cachePos = newPos
          if (this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curPos, this.cachePos)
          }
        }
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
