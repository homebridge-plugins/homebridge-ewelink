import { hasProperty, parseError } from '../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.hapErr = platform.api.hap.HapStatusError
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

    // Check device params to determine if it's a button or switch
    this.isButton = hasProperty(accessory.context.eweParams, 'key')

    if (this.isButton) {
      // Virtual Button - use StatelessProgrammableSwitch
      this.service = this.accessory.getService(this.hapServ.StatelessProgrammableSwitch)
        || this.accessory.addService(this.hapServ.StatelessProgrammableSwitch)

      // Set up the button with single, double, and long press
      this.service.getCharacteristic(this.hapChar.ProgrammableSwitchEvent).setProps({
        minValue: 0,
        maxValue: 2,
        validValues: [0, 1, 2], // Single, Double, Long press
      })

      // Remove switch service if it exists from previous setup
      if (this.accessory.getService(this.hapServ.Switch)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
      }
    } else {
      // Virtual Switch - use standard Switch service
      this.service = this.accessory.getService(this.hapServ.Switch)
        || this.accessory.addService(this.hapServ.Switch)

      // Add the set handler to the switch on/off characteristic
      this.service
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => this.internalStateUpdate(value))

      // Add the get handler only if the user hasn't disabled the disableNoResponse setting
      if (!platform.config.disableNoResponse) {
        this.service.getCharacteristic(this.hapChar.On).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.On).value
        })
      }

      // Remove button service if it exists from previous setup
      if (this.accessory.getService(this.hapServ.StatelessProgrammableSwitch)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.StatelessProgrammableSwitch))
      }
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      type: this.isButton ? 'button' : 'switch',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      // This is only for virtual switches, not buttons
      if (this.isButton) {
        return
      }

      const newValue = value ? 'on' : 'off'

      // Don't continue if the value is the same as before
      const prevState = this.service.getCharacteristic(this.hapChar.On).value
      if (prevState === value) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        switches: [
          {
            outlet: 0,
            switch: newValue,
          },
        ],
      })

      // Cache the new state and log if appropriate
      if (this.enableLogging) {
        this.accessory.eveService.addEntry({
          time: Math.round(Date.now() / 1000),
          status: value ? 1 : 0,
        })
        this.log('[%s] %s [%s].', this.name, this.lang.curState, newValue)
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (this.isButton) {
        // Handle button press events
        if (hasProperty(params, 'key')) {
          // Map key values to HomeKit button events
          let buttonEvent
          switch (params.key) {
            case 0:
              buttonEvent = this.hapChar.ProgrammableSwitchEvent.SINGLE_PRESS
              break
            case 1:
              buttonEvent = this.hapChar.ProgrammableSwitchEvent.DOUBLE_PRESS
              break
            case 2:
              buttonEvent = this.hapChar.ProgrammableSwitchEvent.LONG_PRESS
              break
            default:
              // Unknown key value, default to single press
              buttonEvent = this.hapChar.ProgrammableSwitchEvent.SINGLE_PRESS
          }

          // Update the button event characteristic
          this.service.updateCharacteristic(this.hapChar.ProgrammableSwitchEvent, buttonEvent)

          // Log the button press if appropriate
          if (params.updateSource && this.enableLogging) {
            const pressType = params.key === 0 ? 'single' : params.key === 1 ? 'double' : 'long'
            this.log('[%s] %s [%s press].', this.name, this.lang.curState, pressType)
          }
        }

        // Handle trigger time if provided
        if (hasProperty(params, 'trigTime')) {
          this.lastTriggerTime = params.trigTime
          if (this.enableDebugLogging) {
            this.log('[%s] Button triggered at %s.', this.name, new Date(Number.parseInt(params.trigTime)).toLocaleString())
          }
        }
      } else {
        // Handle virtual switch updates
        if (hasProperty(params, 'switches') && Array.isArray(params.switches)) {
          params.switches.forEach((outlet) => {
            // Check this is the primary outlet
            if (outlet.outlet !== 0) {
              return
            }

            // Check we have a valid switch value
            if (!hasProperty(outlet, 'switch')) {
              return
            }

            const newState = outlet.switch === 'on'
            const prevState = this.service.getCharacteristic(this.hapChar.On).value
            if (prevState === newState) {
              return
            }

            this.service.updateCharacteristic(this.hapChar.On, newState)
            this.cacheState = outlet.switch

            // Add Eve history entry
            this.accessory.eveService.addEntry({
              time: Math.round(Date.now() / 1000),
              status: newState ? 1 : 0,
            })

            // Log the change if appropriate
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, outlet.switch)
            }
          })
        }

        // Also handle single switch param for compatibility
        if (hasProperty(params, 'switch')) {
          const newState = params.switch === 'on'
          const prevState = this.service.getCharacteristic(this.hapChar.On).value
          if (prevState !== newState) {
            this.service.updateCharacteristic(this.hapChar.On, newState)
            this.cacheState = params.switch

            // Add Eve history entry
            this.accessory.eveService.addEntry({
              time: Math.round(Date.now() / 1000),
              status: newState ? 1 : 0,
            })

            // Log the change if appropriate
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, params.switch)
            }
          }
        }
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  async currentState() {
    const toReturn = {}
    if (this.isButton) {
      toReturn.services = ['button']
      toReturn.button = {
        last_trigger: this.lastTriggerTime || 'none',
      }
    } else {
      toReturn.services = ['switch']
      toReturn.switch = {
        state: this.cacheState || 'off',
      }
    }
    return toReturn
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
