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
    this.humiOffset = deviceConf && deviceConf.humidityOffset
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

    // Add the temperature sensor service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor)

    // Set custom properties of the current temperature characteristic
    this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Add the humidity sensor service if it doesn't already exist
    this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor)
    this.cacheHumi = this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value

    // Add the air quality sensor service if it doesn't already exist
    this.airQualityService = this.accessory.getService(this.hapServ.AirQualitySensor)
      || this.accessory.addService(this.hapServ.AirQualitySensor)

    // Add the carbon dioxide sensor service if it doesn't already exist
    this.co2Service = this.accessory.getService(this.hapServ.CarbonDioxideSensor)
      || this.accessory.addService(this.hapServ.CarbonDioxideSensor)
    this.cacheCO2 = this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideLevel).value

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.tempService
        .getCharacteristic(this.hapChar.CurrentTemperature)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
        })
      this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value
      })
      this.airQualityService.getCharacteristic(this.hapChar.AirQuality).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.airQualityService.getCharacteristic(this.hapChar.AirQuality).value
      })
      this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideDetected).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideDetected).value
      })
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      humidityOffset: this.humiOffset,
      humidityOffsetFactor: this.humiOffsetFactor,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  // Convert CO2 ppm to HomeKit AirQuality enum
  // 0: Unknown, 1: Excellent, 2: Good, 3: Fair, 4: Inferior, 5: Poor
  co2ToAirQuality(co2) {
    if (co2 <= 400) {
      return 1 // Excellent
    }
    if (co2 <= 700) {
      return 2 // Good
    }
    if (co2 <= 1000) {
      return 3 // Fair
    }
    if (co2 <= 2000) {
      return 4 // Inferior
    }
    return 5 // Poor
  }

  async externalUpdate(params) {
    try {
      if (hasProperty(params, 'temperature')) {
        let newTemp = Number(params.temperature)
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
      if (hasProperty(params, 'humidity')) {
        let newHumi = Number.parseFloat(params.humidity)
        if (this.humiOffsetFactor) {
          newHumi *= this.humiOffset
        } else {
          newHumi += this.humiOffset
        }
        newHumi = Math.max(Math.min(newHumi, 100), 0)
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
      if (hasProperty(params, 'co2')) {
        const newCO2 = Number.parseInt(params.co2, 10)
        if (newCO2 !== this.cacheCO2) {
          this.cacheCO2 = newCO2

          // Update CO2 level on the carbon dioxide sensor
          this.co2Service.updateCharacteristic(this.hapChar.CarbonDioxideLevel, this.cacheCO2)

          // CO2 detected if above 1000 ppm (typical threshold)
          const co2Detected = this.cacheCO2 > 1000 ? 1 : 0
          this.co2Service.updateCharacteristic(this.hapChar.CarbonDioxideDetected, co2Detected)

          // Update air quality based on CO2 levels
          const airQuality = this.co2ToAirQuality(this.cacheCO2)
          this.airQualityService.updateCharacteristic(this.hapChar.AirQuality, airQuality)
          this.airQualityService.updateCharacteristic(this.hapChar.CarbonDioxideLevel, this.cacheCO2)

          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s ppm].', this.name, this.lang.curCO2, this.cacheCO2)
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

  currentState() {
    const toReturn = {}
    toReturn.services = ['temperature', 'humidity', 'airQuality', 'carbonDioxide']
    toReturn.temperature = {
      current: this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value,
    }
    toReturn.humidity = {
      current: this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value,
    }
    toReturn.airQuality = {
      current: this.airQualityService.getCharacteristic(this.hapChar.AirQuality).value,
    }
    toReturn.carbonDioxide = {
      level: this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideLevel).value,
      detected: this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideDetected).value,
    }
    return toReturn
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
