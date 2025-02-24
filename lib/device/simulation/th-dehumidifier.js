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
        this.enableDebugLogging = platform.config.debug
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

    // Set up the accessory with default target relative humidity when added the first time
    if (!hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 50
    }

    // Check to make sure user has not switched from humidifier to dehumidifier
    if (this.accessory.context.cacheType !== 'dehumidifier') {
      // Remove and re-setup as a HeaterCooler
      if (this.accessory.getService(this.hapServ.HumidifierDehumidifier)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HumidifierDehumidifier))
      }
      this.accessory.context.cacheType = 'dehumidifier'
      this.accessory.context.cacheTarget = 50
    }

    // If the accessory has a thermostat service then remove it
    if (this.accessory.getService(this.hapServ.Thermostat)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Thermostat))
    }

    // If the accessory has a heater service then remove it
    if (this.accessory.getService(this.hapServ.HeaterCooler)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
    }

    // If the accessory has a humidity sensor service then remove it
    if (this.accessory.getService(this.hapServ.HumiditySensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumiditySensor))
    }

    // Add the dehumidifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HumidifierDehumidifier)
      || this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Add the temperature sensor service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor)
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Set the dehumidifier as the primary service
    this.service.setPrimaryService()

    // Add the set handler to the humidifier active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))

    // Add options to the target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
      .updateValue(2)
      .setProps({
        minValue: 2,
        maxValue: 2,
        validValues: [2],
      })

    // Add the set handler to the target relative humidity characteristic
    this.service
      .getCharacteristic(this.hapChar.RelativeHumidityDehumidifierThreshold)
      .updateValue(this.accessory.context.cacheTarget)
      .onSet(async value => this.internalTargetHumidityUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.Active).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.Active).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState).value
      })
      this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value
      })
      this.service
        .getCharacteristic(this.hapChar.RelativeHumidityDehumidifierThreshold)
        .updateValue(this.accessory.context.cacheTarget)
        .onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.RelativeHumidityDehumidifierThreshold)
            .value
        })
    }

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'
    this.cacheHumid = this.cacheState === 'on'
      && this.service.getCharacteristic(this.hapChar.CurrentHumidifierDehumidifierState).value === 3
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

      // Stop the intervals on Homebridge shutdown
      platform.api.on('shutdown', () => clearInterval(this.intervalPoll))
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      humidityOffset: this.humiOffset,
      humidityOffsetFactor: this.humiOffsetFactor,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
      showAs: 'dehumidifier',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const params = { deviceType: 'normal' }
      let newState
      let newHumid
      if (value === 0) {
        params.mainSwitch = 'off'
        params.switch = 'off'
        newState = 'off'
        newHumid = 'off'
      } else if (this.cacheHumi > this.accessory.context.cacheTarget) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newState = 'on'
        newHumid = 'on'
      } else {
        params.mainSwitch = 'off'
        params.switch = 'off'
        newState = 'on'
        newHumid = 'off'
      }

      // Only send the update if either:
      // * The new value (state) is OFF and the cacheHumid was ON
      // * The new value (state) is ON and newHumid is 'on'
      if ((value === 0 && this.cacheHumid === 'on') || (value === 1 && newHumid === 'on')) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if (newState !== this.cacheState) {
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (newHumid !== this.cacheHumid) {
        this.cacheHumid = newHumid
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curDehumid, this.cacheHumid)
        }
      }
      const hapState = this.cacheHumid === 'on' ? 3 : 1
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
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

  async internalTargetHumidityUpdate(value) {
    try {
      if (value === this.accessory.context.cacheTarget) {
        return
      }
      this.accessory.context.cacheTarget = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curTarg, value)
      }
      if (this.cacheState === 'off') {
        return
      }
      const params = { deviceType: 'normal' }
      let newHumid
      if (this.cacheHumi > value) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newHumid = 'on'
      } else {
        params.mainSwitch = 'off'
        params.switch = 'off'
        newHumid = 'off'
      }
      if (newHumid === this.cacheHumid) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHumid = newHumid
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curDehumid, this.cacheHumid)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.cacheHumid === 'on' ? 3 : 1,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.RelativeHumidityDehumidifierThreshold,
          this.accessory.context.cacheTarget,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCurrentHumidityUpdate() {
    try {
      if (this.cacheState === 'off') {
        return
      }
      const params = { deviceType: 'normal' }
      let newHumid
      if (this.cacheHumi > this.accessory.context.cacheTarget) {
        params.mainSwitch = 'on'
        params.switch = 'on'
        newHumid = 'on'
      } else {
        params.mainSwitch = 'off'
        params.switch = 'off'
        newHumid = 'off'
      }
      if (newHumid === this.cacheHumid) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHumid = newHumid
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curDehumid, this.cacheHumid)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHumidifierDehumidifierState,
        this.cacheHumid === 'on' ? 3 : 1,
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
          this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
          this.accessory.eveService.addEntry({ humidity: this.cacheHumi })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curHumi, this.cacheHumi)
          }
          this.internalCurrentHumidityUpdate()
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
