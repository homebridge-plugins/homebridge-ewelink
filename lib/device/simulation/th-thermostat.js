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
    this.minTarget = deviceConf.minTarget || platformConsts.defaultValues.minTarget
    this.maxTarget = deviceConf.maxTarget
      ? Math.max(deviceConf.maxTarget, this.minTarget + 1)
      : platformConsts.defaultValues.maxTarget
    this.showHeatCool = deviceConf.showHeatCool

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

    // Set up the accessory with default target temp when added the first time
    if (!hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 20
    }

    // If the accessory has a heater service then remove it
    if (this.accessory.getService(this.hapServ.HeaterCooler)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
    }

    // If the accessory has a humidifier service then remove it
    if (this.accessory.getService(this.hapServ.HumidifierDehumidifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumidifierDehumidifier))
    }

    // If the accessory has a humidity sensor service then remove it
    if (this.accessory.getService(this.hapServ.HumiditySensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumiditySensor))
    }

    // Add a context property to save the desired state of the showHeatCool option
    if (!hasProperty(accessory.context, 'showHeatCool')) {
      accessory.context.showHeatCool = false
    }

    // Reset the thermostat service if showHeatCool has been switched on from off
    if (this.showHeatCool && !accessory.context.showHeatCool) {
      accessory.context.showHeatCool = true
      if (this.accessory.getService(this.hapServ.Thermostat)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Thermostat))
      }
    }

    // Reset the thermostat service if showHeatCool has been switched off from on
    if (!this.showHeatCool && accessory.context.showHeatCool) {
      accessory.context.showHeatCool = false
      if (this.accessory.getService(this.hapServ.Thermostat)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Thermostat))
      }
    }

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    // The DS18B20 sensor does not provide humidity readings
    if (this.accessory.context.sensorType === 'DS18B20') {
      if (this.service.testCharacteristic(this.hapChar.CurrentRelativeHumidity)) {
        this.service.removeCharacteristic(
          this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity),
        )
      }
    } else {
      if (!this.service.testCharacteristic(this.hapChar.CurrentRelativeHumidity)) {
        this.service.addCharacteristic(this.hapChar.CurrentRelativeHumidity)
      }
      this.humiService = true
    }

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    })
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Add options to the target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        validValues: this.showHeatCool ? [0, 1, 2] : [0, 3],
      })
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .updateValue(this.accessory.context.cacheTarget)
      .setProps({
        minValue: this.minTarget,
        maxValue: this.maxTarget,
        minStep: 0.5,
      })
      .onSet(async value => this.internalTargetTempUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.CurrentTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      })
      this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value
      })
      this.service.getCharacteristic(this.hapChar.CurrentHeatingCoolingState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentHeatingCoolingState).value
      })
      this.service.getCharacteristic(this.hapChar.TargetTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetTemperature).value
      })
    }

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    const curState = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value
    this.cacheState = curState > 0 ? 'on' : 'off'
    const heatTest = this.service.getCharacteristic(this.hapChar.TargetTemperature).value
      > this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      ? 'on'
      : 'off'
    this.cacheHeat = this.cacheState === 'on' && [1, 3].includes(curState)
      ? heatTest
      : undefined
    const coolTest = this.service.getCharacteristic(this.hapChar.TargetTemperature).value
      < this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      ? 'on'
      : 'off'
    this.cacheCool = this.cacheState === 'on' && curState === 2
      ? coolTest
      : undefined

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
      maxTarget: this.maxTarget,
      minTarget: this.minTarget,
      offset: this.tempOffset,
      offsetFactor: this.tempOffsetFactor,
      showAs: 'heater',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const params = { deviceType: 'normal' }

      // this.showHeatCool true, values can be 0, 1, 2 otherwise 0, 3
      let newState
      let newHeat
      let newCool
      switch (value) {
        case 0:
          // Turning off
          params.mainSwitch = 'off'
          params.switch = 'off'
          newState = 'off'
          newHeat = 'off'
          newCool = 'off'
          break
        case 1:
          // Turning to heat
          if (!this.showHeatCool) {
            return
          }
          if (this.cacheTemp < this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newState = 'on'
            newHeat = 'on'
            newCool = 'off'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newState = 'on'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        case 2:
          // Turning to cool
          if (!this.showHeatCool) {
            return
          }
          if (this.cacheTemp > this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newState = 'on'
            newHeat = 'off'
            newCool = 'on'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newState = 'on'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        case 3:
          // Turning to auto
          if (this.showHeatCool) {
            return
          }
          if (this.cacheTemp < this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newState = 'on'
            newHeat = 'on'
            newCool = 'off'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newState = 'on'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        default:
          return
      }

      // Only send the update if either:
      // * The new value (state) is OFF and (the cacheHeat was ON or cacheCool was ON)
      // * The new value (state) is ON and (newHeat is 'on' or newCool is 'on')
      // * (cacheHeat was ON and newCool is ON) or (cacheCool was ON and newHeat is ON)
      if (
        (value === 0 && (this.cacheHeat === 'on' || this.cacheCool === 'on'))
        || ([1, 3].includes(value) && newHeat !== this.cacheHeat)
        || (value === 2 && newCool !== this.cacheCool)
      ) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if (newState !== this.cacheState) {
        this.cacheState = newState
        this.cacheHeat = undefined
        this.cacheCool = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if ([1, 3].includes(value) && newHeat !== this.cacheHeat) {
        this.cacheHeat = newHeat
        this.cacheCool = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
        }
      }
      if (value === 2 && newCool !== this.cacheCool) {
        this.cacheCool = newCool
        this.cacheHeat = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
        }
      }
      const hapState = this.cacheHeat === 'on' ? 1 : 0
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        this.cacheCool === 'on' ? 2 : hapState,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        const hapState = this.cacheHeat === 'on' ? 1 : 0
        this.service.updateCharacteristic(
          this.hapChar.TargetHeatingCoolingState,
          this.cacheCool === 'on' ? 2 : hapState,
        )
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
      let newHeat
      let newCool

      const curMode = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value
      switch (curMode) {
        case 1:
        case 3:
          // Currently in heating or auto mode
          if (this.cacheTemp < this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newHeat = 'on'
            newCool = 'off'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        case 2:
          // Currently in cooling mode
          if (this.cacheTemp > this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newHeat = 'off'
            newCool = 'on'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        default:
          return
      }

      // Only send the update if either:
      // * The new value (state) is ON and (newHeat is 'on' or newCool is 'on')
      // * (cacheHeat was ON and newCool is ON) or (cacheCool was ON and newHeat is ON)
      if (
        ([1, 3].includes(curMode) && newHeat !== this.cacheHeat)
        || (curMode === 2 && newCool !== this.cacheCool)
      ) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if ([1, 3].includes(curMode) && newHeat !== this.cacheHeat) {
        this.cacheHeat = newHeat
        this.cacheCool = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
        }
      }
      if (curMode === 2 && newCool !== this.cacheCool) {
        this.cacheCool = newCool
        this.cacheHeat = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
        }
      }
      const hapState = this.cacheHeat === 'on' ? 1 : 0
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        this.cacheCool === 'on' ? 2 : hapState,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetTemperature,
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
      let newHeat
      let newCool

      const curMode = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value
      switch (curMode) {
        case 1:
        case 3:
          // Currently in heating or auto mode
          if (this.cacheTemp < this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newHeat = 'on'
            newCool = 'off'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        case 2:
          // Currently in cooling mode
          if (this.cacheTemp > this.accessory.context.cacheTarget) {
            params.mainSwitch = 'on'
            params.switch = 'on'
            newHeat = 'off'
            newCool = 'on'
          } else {
            params.mainSwitch = 'off'
            params.switch = 'off'
            newHeat = 'off'
            newCool = 'off'
          }
          break
        default:
          return
      }

      // Only send the update if either:
      // * The new value (state) is ON and (newHeat is 'on' or newCool is 'on')
      // * (cacheHeat was ON and newCool is ON) or (cacheCool was ON and newHeat is ON)
      if (
        ([1, 3].includes(curMode) && newHeat !== this.cacheHeat)
        || (curMode === 2 && newCool !== this.cacheCool)
      ) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if ([1, 3].includes(curMode) && newHeat !== this.cacheHeat) {
        this.cacheHeat = newHeat
        this.cacheCool = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
        }
      }
      if (curMode === 2 && newCool !== this.cacheCool) {
        this.cacheCool = newCool
        this.cacheHeat = undefined
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curCool, this.cacheCool)
        }
      }
      const hapState = this.cacheHeat === 'on' ? 1 : 0
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        this.cacheCool === 'on' ? 2 : hapState,
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
          this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
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

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
