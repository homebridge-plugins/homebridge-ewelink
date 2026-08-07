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
    this.hideSwitch = deviceConf.hideSwitch
    this.tempOffset = deviceConf.offset || platformConsts.defaultValues.offset
    this.tempOffsetFactor = deviceConf.offsetFactor
    this.humiOffset = deviceConf.humidityOffset
      ? Number.parseInt(deviceConf.humidityOffset, 10)
      : platformConsts.defaultValues.humidityOffset
    this.humiOffsetFactor = deviceConf.humidityOffsetFactor

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

    // If the accessory has a thermostat service then remove it
    if (this.accessory.getService(this.hapServ.Thermostat)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Thermostat))
    }

    // If the accessory has a heater service then remove it
    if (this.accessory.getService(this.hapServ.HeaterCooler)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
    }

    // If the accessory has a humidifier service then remove it
    if (this.accessory.getService(this.hapServ.HumidifierDehumidifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumidifierDehumidifier))
    }

    // The user can choose to hide the switch service if they desire
    if (this.hideSwitch) {
      // User has hidden the switch service so remove it if it exists
      if (this.accessory.getService(this.hapServ.Switch)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
      }
    } else {
      // User has not hidden the switch service so add it if it doesn't already exist
      this.switchService = this.accessory.getService(this.hapServ.Switch)
        || this.accessory.addService(this.hapServ.Switch)

      // Add the set handler to the switch on/off characteristic
      this.switchService
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => this.internalStateUpdate(value))
    }

    // Add the temperature sensor service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor)

    // Set custom properties of the current temperature characteristic
    this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

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

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      if (this.switchService) {
        this.switchService.getCharacteristic(this.hapChar.On).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.switchService.getCharacteristic(this.hapChar.On).value
        })
      }
      this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
      if (this.humiService) {
        this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value
        })
      }
    }

    // The switch as the primary service ensures the status is reflected in the Home icon
    if (this.switchService) {
      this.switchService.setPrimaryService()
    }

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
      hideSwitch: this.hideSwitch,
      humidityOffset: this.humiOffset,
      humidityOffsetFactor: this.humiOffsetFactor,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
      showAs: 'default',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (newValue === this.cacheState) {
        return
      }
      const params = {
        switch: newValue,
        mainSwitch: newValue,
        deviceType: 'normal',
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newValue
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.switchService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
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
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: 120 })
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (!this.hideSwitch && params.switch) {
        const newState = params.switch
        if (this.cacheState !== newState) {
          this.cacheState = newState
          this.switchService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
          this.accessory.eveService.addEntry({
            status: this.cacheState === 'on' ? 1 : 0,
          })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
          }
        }
      }
      if (
        hasProperty(params, 'currentTemperature')
        && params.currentTemperature !== 'unavailable'
      ) {
        const rawTemp = Number(params.currentTemperature)
        if (Number.isNaN(rawTemp) || rawTemp < -270 || rawTemp > 270) {
          return
        }
        let newTemp = rawTemp
        if (this.tempOffsetFactor) {
          newTemp *= this.tempOffset
        } else {
          newTemp += this.tempOffset
        }
        if (newTemp !== this.cacheTemp) {
          this.cacheTemp = newTemp
          this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
          this.accessory.eveService.addEntry({ temp: this.cacheTemp })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, this.cacheTemp)
          }

          // Update the cache file with the new temperature
          this.updateCache()
        }
      }
      if (
        hasProperty(params, 'currentHumidity')
        && params.currentHumidity !== 'unavailable'
        && this.humiService
      ) {
        const rawHumi = Number.parseInt(params.currentHumidity, 10)
        if (rawHumi === 0) {
          return
        }
        let newHumi = rawHumi
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

    // Update in-memory temperature cache for cross-device sharing
    if (this.platform.temperatureCache) {
      this.platform.temperatureCache.set(this.accessory.context.eweDeviceId, this.cacheTemp)
    }

    // Attempt to save the new temperature to the persistent cache
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

  currentState() {
    const toReturn = {}
    toReturn.services = ['switch', 'temperature']
    toReturn.switch = {
      state: this.cacheState,
    }
    toReturn.temperature = {
      current: this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value,
    }
    if (this.humiService) {
      toReturn.services.push('humidity')
      toReturn.humidity = {
        current: this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value,
      }
    }
    return toReturn
  }

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
