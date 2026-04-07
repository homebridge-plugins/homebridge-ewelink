import { hasProperty, parseError } from '../../utils/functions.js'

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
    this.temperatureSource = deviceConf.temperatureSource

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

    // Set up the accessory with default target temp when added the first time
    if (!hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 20
    }

    // Check to make sure user has not switched from cooler to heater
    if (this.accessory.context.cacheType !== 'cooler') {
      // Remove and re-setup as a HeaterCooler
      if (this.accessory.getService(this.hapServ.HeaterCooler)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
      }
      this.accessory.context.cacheType = 'cooler'
      this.accessory.context.cacheTarget = 20
    }

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
      || this.accessory.addService(this.hapServ.HeaterCooler)

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value

    // Add the set handler to the heater active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).setProps({
      minValue: 0,
      maxValue: 0,
      validValues: [0],
    })

    // Add the set handler to the target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.CoolingThresholdTemperature)
      .updateValue(this.accessory.context.cacheTarget)
      .setProps({ minStep: 0.5 })
      .onSet(async value => this.internalTargetTempUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
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
      this.service.getCharacteristic(this.hapChar.CoolingThresholdTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CoolingThresholdTemperature).value
      })
    }

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'
    this.cacheCool = this.cacheState === 'on'
      && this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).value === 3
      ? 'on'
      : 'off'

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    // Set up an interval to get regular temperature updates
    setTimeout(() => {
      this.getTemperature()
      this.intervalPoll = setInterval(() => this.getTemperature(), 120000)
    }, 5000)

    // Stop the intervals on Homebridge shutdown
    platform.api.on('shutdown', () => {
      clearInterval(this.intervalPoll)
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'cooler',
      temperatureSource: this.temperatureSource,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      let newState
      let newCool
      const params = {}
      if (value === 0) {
        params.switch = 'off'
        newState = 'off'
        newCool = 'off'
      } else if (this.cacheTemp > this.accessory.context.cacheTarget) {
        params.switch = 'on'
        newState = 'on'
        newCool = 'on'
      } else {
        params.switch = 'off'
        newState = 'on'
        newCool = 'off'
      }

      // Only send the update if either:
      // * The new value (state) is OFF and the cacheCool was ON
      // * The new value (state) is ON and newCool is 'on'
      if ((value === 0 && this.cacheCool === 'on') || (value === 1 && newCool === 'on')) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if (newState !== this.cacheState) {
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (newCool !== this.cacheCool) {
        this.cacheCool = newCool
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
        }
      }
      const hapState = this.cacheCool === 'on' ? 3 : 1
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        value === 1 ? hapState : 0,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetTempUpdate(value) {
    try {
      if (value === this.accessory.context.cacheTarget) {
        return
      }
      this.accessory.context.cacheTarget = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s°C].', this.name, this.lang.curTarg, value)
      }
      if (this.cacheState === 'off') {
        return
      }
      const params = {}
      let newCool
      if (this.cacheTemp > value) {
        params.switch = 'on'
        newCool = 'on'
      } else {
        params.switch = 'off'
        newCool = 'off'
      }
      if (newCool === this.cacheCool) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheCool = newCool
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        this.cacheCool === 'on' ? 3 : 1,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.CoolingThresholdTemperature,
          this.accessory.context.cacheTarget,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCurrentTempUpdate() {
    try {
      if (this.cacheState === 'off') {
        return
      }
      const params = {}
      let newCool
      if (this.cacheTemp > this.accessory.context.cacheTarget) {
        params.switch = 'on'
        newCool = 'on'
      } else {
        params.switch = 'off'
        newCool = 'off'
      }
      if (newCool === this.cacheCool) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheCool = newCool
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        this.cacheCool === 'on' ? 3 : 1,
      )
    } catch (err) {
      this.log.warn('[%s] %s.', this.name, parseError(err))
    }
  }

  async getTemperature() {
    try {
      // Skip polling if device isn't online or if the storage hasn't initialised properly
      if (!this.isOnline || !this.platform.storageClientData) {
        return
      }

      const newTemp = this.platform.temperatureCache?.get(this.temperatureSource)
        ?? await this.platform.storageData.getItem(`${this.temperatureSource}_temp`)
      if (newTemp && newTemp !== this.cacheTemp) {
        this.cacheTemp = newTemp
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
        this.accessory.eveService.addEntry({ temp: this.cacheTemp })
        if (this.enableLogging) {
          this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, this.cacheTemp)
        }
        this.internalCurrentTempUpdate()
      }
    } catch (err) {
      this.log.warn('[%s] %s.', this.name, parseError(err))
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
