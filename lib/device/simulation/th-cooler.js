import platformConsts from '../../utils/constants.js'
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
    this.tempOffset = deviceConf.offset || platformConsts.defaultValues.offset
    this.tempOffsetFactor = deviceConf.offsetFactor
    this.humiOffset = deviceConf && deviceConf.humidityOffset
      ? Number.parseInt(deviceConf.humidityOffset, 10)
      : platformConsts.defaultValues.humidityOffset
    this.humiOffsetFactor = deviceConf.humidityOffsetFactor
    this.minTarget = deviceConf.minTarget || platformConsts.defaultValues.minTarget
    this.maxTarget = deviceConf.maxTarget
      ? Math.max(deviceConf.maxTarget, this.minTarget + 1)
      : platformConsts.defaultValues.maxTarget

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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a temperature sensor service then remove it
    if (this.accessory.getService(this.hapServ.TemperatureSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.TemperatureSensor))
    }

    // Set up the accessory with default target temp when added the first time
    if (!hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 20
    }

    // Check to make sure user has not switched from heater to cooler
    if (this.accessory.context.cacheType !== 'cooler') {
      // Remove and re-setup as a HeaterCooler
      if (this.accessory.getService(this.hapServ.HeaterCooler)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
      }
      this.accessory.context.cacheType = 'cooler'
      this.accessory.context.cacheTarget = 20
    }

    // If the accessory has a thermostat service then remove it
    if (this.accessory.getService(this.hapServ.Thermostat)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Thermostat))
    }

    // If the accessory has a humidifier service then remove it
    if (this.accessory.getService(this.hapServ.HumidifierDehumidifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumidifierDehumidifier))
    }

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
      || this.accessory.addService(this.hapServ.HeaterCooler)

    // The DS18B20 sensor does not provide humidity readings
    if (this.accessory.context.sensorType === 'DS18B20') {
      if (this.accessory.getService(this.hapServ.HumiditySensor)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HumiditySensor))
      }
    } else {
      // Add the humidity sensor service if it doesn't already exist
      this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
        || this.accessory.addService(this.hapServ.HumiditySensor)
    }

    // Set the heater as the primary service
    this.service.setPrimaryService()

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

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

    // Add a get handler to the current state characteristics
    this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).onGet(() => {
      if (!this.isOnline) {
        throw new this.hapErr(-70402)
      }
      return this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).value
    })

    // Add the set handler to the target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.CoolingThresholdTemperature)
      .updateValue(this.accessory.context.cacheTarget)
      .setProps({
        minValue: this.minTarget,
        maxValue: this.maxTarget,
        minStep: 0.5,
      })
      .onSet(async value => this.internalTargetTempUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      if (this.humiService) {
        this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value
        })
      }
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

    // Set up an interval to get eWeLink to send regular temperature/humidity updates
    if (platform.config.mode !== 'lan') {
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      humidityOffset: this.humiOffset,
      humidityOffsetFactor: this.humiOffsetFactor,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      maxTarget: this.maxTarget,
      minTarget: this.minTarget,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
      showAs: 'cooler',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const params = { deviceType: 'normal' }
      let newState
      let newCool
      if (value === 0) {
        params.mainSwitch = 'off'
        params.switch = 'off'
        newState = 'off'
        newCool = 'off'
      } else if (this.cacheTemp > this.accessory.context.cacheTarget) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newState = 'on'
        newCool = 'on'
      } else {
        params.mainSwitch = 'off'
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
      const params = { deviceType: 'normal' }
      let newCool
      if (this.cacheTemp > value) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newCool = 'on'
      } else {
        params.mainSwitch = 'off'
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
      const params = { deviceType: 'normal' }
      let newCool
      if (this.cacheTemp > this.accessory.context.cacheTarget) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newCool = 'on'
      } else {
        params.mainSwitch = 'off'
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
      // Suppress errors here
    }
  }

  async internalUIUpdate() {
    try {
      // Skip polling if device isn't online
      if (!this.isOnline) {
        return
      }

      // Send the params to request the updates
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: 120 })
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (
        hasProperty(params, 'currentTemperature')
        && params.currentTemperature !== 'unavailable'
      ) {
        let newTemp = Number(params.currentTemperature)
        if (this.tempOffsetFactor) {
          newTemp *= this.tempOffset
        } else {
          newTemp += this.tempOffset
        }
        if (newTemp !== this.cacheTemp) {
          this.cacheTemp = newTemp
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
          this.accessory.eveService.addEntry({ temp: this.cacheTemp })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, this.cacheTemp)
          }

          // Update the cache file with the new temperature
          this.updateCache()
          this.internalCurrentTempUpdate()
        }
      }
      if (
        hasProperty(params, 'currentHumidity')
        && params.currentHumidity !== 'unavailable'
        && this.humiService
      ) {
        let newHumi = Number.parseInt(params.currentHumidity, 10)
        if (this.humiOffsetFactor) {
          newHumi *= this.humiOffset
        } else {
          newHumi += this.humiOffset
        }
        newHumi = Math.max(Math.min(Number.parseInt(newHumi, 10), 100), 0)
        if (newHumi !== this.cacheHumi) {
          this.cacheHumi = newHumi
          this.humiService.updateCharacteristic(
            this.hapChar.CurrentRelativeHumidity,
            this.cacheHumi,
          )
          this.accessory.eveService.addEntry({ humidity: this.cacheHumi })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curHumi, this.cacheHumi)
          }
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

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
