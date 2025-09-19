import platformConsts from '../utils/constants.js'
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
    this.tempOffset = deviceConf.offset || platformConsts.defaultValues.offset
    this.tempOffsetFactor = deviceConf.offsetFactor

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

    // Add the heater cooler service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
      || this.accessory.addService(this.hapServ.HeaterCooler)

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value

    // Add the set handler to the active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalActiveUpdate(value))

    // Add the set handler to the target heater cooler state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHeaterCoolerState)
      .setProps({
        minValue: 0,
        maxValue: 2,
        validValues: [0, 1, 2], // Auto, Heat, Cool
      })
      .onSet(async value => this.internalModeUpdate(value))

    // Add the set handler to the cooling threshold temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.CoolingThresholdTemperature)
      .setProps({
        minValue: 16,
        maxValue: 32,
        minStep: 1,
      })
      .onSet(async value => this.internalTempUpdate(value, 'cool'))

    // Add the set handler to the heating threshold temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minValue: 16,
        maxValue: 32,
        minStep: 1,
      })
      .onSet(async value => this.internalTempUpdate(value, 'heat'))

    // Add the set handler to the rotation speed characteristic (for fan speed)
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      })
      .onSet(async value => this.internalSpeedUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.Active).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.Active).value
      })
      this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.CoolingThresholdTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CoolingThresholdTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.RotationSpeed).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      })
    }

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.CoolingThresholdTemperature).value
    this.cacheMode = 'cool'
    this.cacheSpeed = 50

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalActiveUpdate(value) {
    try {
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the value is the same as before
      const prevState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'
      if (prevState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        power: newValue,
      })

      // Update the current state characteristic
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        value === 1
          ? (this.cacheMode === 'heat'
              ? this.hapChar.CurrentHeaterCoolerState.HEATING
              : this.hapChar.CurrentHeaterCoolerState.COOLING)
          : this.hapChar.CurrentHeaterCoolerState.INACTIVE,
      )

      // Cache the new state and log if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, newValue)
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      const prevStateValue = this.service.getCharacteristic(this.hapChar.Active).value
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevStateValue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalModeUpdate(value) {
    try {
      let newMode
      switch (value) {
        case 0: // Auto
          newMode = 'auto'
          break
        case 1: // Heat
          newMode = 'heat'
          break
        case 2: // Cool
          newMode = 'cool'
          break
        default:
          return
      }

      // Don't continue if the value is the same as before
      if (this.cacheMode === newMode) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        mode: newMode,
      })

      // Update the current state characteristic if device is on
      if (this.service.getCharacteristic(this.hapChar.Active).value === 1) {
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeaterCoolerState,
          value === 1
            ? this.hapChar.CurrentHeaterCoolerState.HEATING
            : value === 2
              ? this.hapChar.CurrentHeaterCoolerState.COOLING
              : this.hapChar.CurrentHeaterCoolerState.IDLE,
        )
      }

      // Cache the new mode and log if appropriate
      this.cacheMode = newMode
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, newMode)
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        const prevValue = this.cacheMode === 'heat' ? 1 : this.cacheMode === 'cool' ? 2 : 0
        this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, prevValue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTempUpdate(value, mode) {
    try {
      // Only update if this is the active mode or auto mode
      if (this.cacheMode !== mode && this.cacheMode !== 'auto') {
        return
      }

      // Don't continue if the value is the same as before
      if (this.cacheTarg === value) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        temperature: value,
      })

      // Cache the new target temperature and log if appropriate
      this.cacheTarg = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s°C].', this.name, this.lang.tarTemp, value)
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        if (mode === 'cool') {
          this.service.updateCharacteristic(this.hapChar.CoolingThresholdTemperature, this.cacheTarg)
        } else {
          this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Map HomeKit 0-100 to eWeLink wind speed values
      // Assuming 101 = low, 102 = medium, 103 = high
      let windSpeed
      if (value === 0) {
        windSpeed = 0
      } else if (value <= 33) {
        windSpeed = 101
      } else if (value <= 66) {
        windSpeed = 102
      } else {
        windSpeed = 103
      }

      // Don't continue if the value is the same as before
      if (this.cacheSpeed === windSpeed) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        wind_speed: windSpeed,
      })

      // Cache the new speed and log if appropriate
      this.cacheSpeed = windSpeed
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curSpeed, value)
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Map cached speed back to HomeKit value
      let prevValue = 50
      if (this.cacheSpeed === 101) {
        prevValue = 25
      } else if (this.cacheSpeed === 102) {
        prevValue = 50
      } else if (this.cacheSpeed === 103) {
        prevValue = 75
      }

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevValue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      // Check to see if the provided params are valid for this model
      if (
        !hasProperty(params, 'power')
        && !hasProperty(params, 'mode')
        && !hasProperty(params, 'temperature')
        && !hasProperty(params, 'indoor_temperature')
        && !hasProperty(params, 'wind_speed')
      ) {
        throw new Error(this.lang.paramsNotRecd)
      }

      // Update the active characteristic
      if (hasProperty(params, 'power')) {
        const newState = params.power === 'on' ? 1 : 0
        this.service.updateCharacteristic(this.hapChar.Active, newState)

        // Update the current state
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeaterCoolerState,
          newState === 1
            ? (this.cacheMode === 'heat'
                ? this.hapChar.CurrentHeaterCoolerState.HEATING
                : this.hapChar.CurrentHeaterCoolerState.COOLING)
            : this.hapChar.CurrentHeaterCoolerState.INACTIVE,
        )

        // Log the change if appropriate
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, params.power)
        }
      }

      // Update the mode characteristic
      if (hasProperty(params, 'mode')) {
        let targetState
        switch (params.mode) {
          case 'auto':
            targetState = 0
            break
          case 'heat':
            targetState = 1
            break
          case 'cool':
            targetState = 2
            break
          default:
            return
        }

        this.cacheMode = params.mode
        this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, targetState)

        // Update current state if device is on
        if (this.service.getCharacteristic(this.hapChar.Active).value === 1) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentHeaterCoolerState,
            targetState === 1
              ? this.hapChar.CurrentHeaterCoolerState.HEATING
              : targetState === 2
                ? this.hapChar.CurrentHeaterCoolerState.COOLING
                : this.hapChar.CurrentHeaterCoolerState.IDLE,
          )
        }

        // Log the change if appropriate
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curMode, params.mode)
        }
      }

      // Update the target temperature
      if (hasProperty(params, 'temperature')) {
        this.cacheTarg = params.temperature
        this.service.updateCharacteristic(this.hapChar.CoolingThresholdTemperature, params.temperature)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, params.temperature)

        // Log the change if appropriate
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s°C].', this.name, this.lang.tarTemp, params.temperature)
        }
      }

      // Update the current temperature
      if (hasProperty(params, 'indoor_temperature')) {
        let newTemp = Number(params.indoor_temperature)

        // Apply any configured offset
        if (this.tempOffsetFactor) {
          newTemp *= this.tempOffsetFactor
        }
        newTemp += this.tempOffset
        newTemp = Math.round(newTemp * 10) / 10

        this.cacheTemp = newTemp
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
        this.accessory.eveService.addEntry({
          time: Math.round(Date.now() / 1000),
          temp: newTemp,
        })

        // Log the change if appropriate
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, newTemp)
        }
      }

      // Update the fan speed
      if (hasProperty(params, 'wind_speed')) {
        // Map eWeLink wind speed to HomeKit rotation speed
        let rotationSpeed = 50
        if (params.wind_speed === 0) {
          rotationSpeed = 0
        } else if (params.wind_speed === 101) {
          rotationSpeed = 25
        } else if (params.wind_speed === 102) {
          rotationSpeed = 50
        } else if (params.wind_speed === 103) {
          rotationSpeed = 75
        }

        this.cacheSpeed = params.wind_speed
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotationSpeed)

        // Log the change if appropriate
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curSpeed, rotationSpeed)
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
    toReturn.services = ['heater-cooler']
    toReturn.heater_cooler = {
      state: this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off',
      mode: this.cacheMode,
      target_temp: this.cacheTarg,
      current_temp: this.cacheTemp,
    }
    return toReturn
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
