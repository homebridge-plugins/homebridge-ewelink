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

    /*
      **************
      *** PARAMS ***
      **************
      "volatility": 1, no plan to implement
      "targetTemp": 20, implemented; will set mode in ewelink to C
      "workMode": 1, implemented 1; 1=manual, 2=programmed 3=economical
      "switch": "on", implemented
      "temperature": 29, implemented; F will be converted to C
      "fault": 0, no plan to implemented
      "workState": 2, implemented 1&2; 1=heating, 2=auto
      "tempScale": "c", implemented c; no plan to implement f
      "childLock": "off", no plan to implement
      "mon": "016800c801e0009602b20096032a009603fc00dc05280096", no
      "tues": "016800c801e0009602b20096032a009603fc00dc05280096", plans
      "wed": "016800c801e0009602b20096032a009603fc00dc05280096", to
      "thur": "016800c801e0009602b20096032a009603fc00dc05280096", implement
      "fri": "016800c801e0009602b20096032a009603fc00dc05280096", the
      "sat": "016800c801e000c802b200c8032a00c803fc00c805280096", schedule
      "sun": "016800c801e000c802b200c8032a00c803fc00c805280096", program
    */

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Add the set handler to the target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .setProps({
        minValue: 5,
        maxValue: 45,
        minStep: 0.5,
      })
      .onSet(async value => this.internalTargetUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentHeatingCoolingState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentHeatingCoolingState).value
      })
      this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value
      })
      this.service.getCharacteristic(this.hapChar.TargetTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetTemperature).value
      })
    }

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

  async internalStateUpdate(value) {
    try {
      const newValue = value !== 0 ? 'on' : 'off'
      const params = {
        switch: newValue,
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (value === 0) {
        this.service.updateCharacteristic(this.hapChar.CurrentHeatingCoolingState, 0)
      }
      this.cacheState = newValue
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetHeatingCoolingState,
          this.cacheState === 'on' ? 1 : 0,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      const params = {
        workMode: 1,
        targetTemp: value,
        tempScale: 'c',
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheTarg = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s°C].', this.name, this.lang.curTarg, this.cacheTarg)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (params.switch && params.switch !== this.cacheState) {
        this.cacheState = params.switch
        if (this.cacheState === 'off') {
          this.service.updateCharacteristic(this.hapChar.CurrentHeatingCoolingState, 0)
        }
        this.service.updateCharacteristic(
          this.hapChar.TargetHeatingCoolingState,
          this.cacheState === 'on' ? 1 : 0,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }

      if (params.workState) {
        const workState = params.workState === 1 ? 'on' : 'off'
        if (this.cacheHeat !== workState) {
          this.cacheHeat = workState
          this.service.updateCharacteristic(
            this.hapChar.CurrentHeatingCoolingState,
            this.cacheHeat === 'on' ? 1 : 0,
          )
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
          }
        }
      }

      if (hasProperty(params, 'targetTemp')) {
        const targetTemp = Number(params.targetTemp)
        if (this.cacheTarg !== targetTemp) {
          this.cacheTarg = targetTemp
          this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s°C].', this.name, this.lang.curTarg, this.cacheTarg)
          }
        }
      }

      if (hasProperty(params, 'temperature')) {
        let currentTemp
        if (params.tempScale && params.tempScale === 'f') {
          // Convert to celcius
          currentTemp = ((Number(params.temperature) - 32) * 5) / 9

          // Round to nearest 0.5
          currentTemp = Math.round(currentTemp * 2) / 2
        } else {
          currentTemp = Number(params.temperature)
        }
        if (this.tempOffsetFactor) {
          currentTemp *= this.tempOffset
        } else {
          currentTemp += this.tempOffset
        }

        if (this.cacheTemp !== currentTemp) {
          this.cacheTemp = currentTemp
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
          this.accessory.eveService.addEntry({ temp: this.cacheTemp })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, this.cacheTemp)
          }

          // Update the cache file with the new temperature
          this.updateCache()
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  async updateCache() {
    // Don't continue if the storage client hasn't initialised properly
    if (!this.platform.storageClientData) {
      return
    }

    // Attempt to save the new temperature to the cache
    try {
      await this.platform.storageData.setItem(
        `${this.accessory.context.eweDeviceId}_temp`,
        this.cacheTemp,
      )
    } catch (err) {
      if (this.enableLogging) {
        this.log.warn('[%s] %s %s.', this.name, this.lang.storageWriteErr, parseError(err))
      }
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
