import platformConsts from '../../utils/constants.js'
import { hasProperty, parseError } from '../../utils/functions.js'

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
        this.enableDebugLogging = false
        break
    }

    /*
      **************
      *** PARAMS ***
      **************
      "subDevId": "",
      "parentid": "",
      "fwVersion": "1.1.1",
      "battery": 100,
      "supportPowConfig": 1,
      "ecoTargetTemp": 70,
      "step": "008d",
      "limitVoltage": "0507",
      "runVoltage": "0593",
      "temperature": 230,
      "trigTime": "1698510595000",
      "mon": "000000a001a400be025800a0025800a003fc00be056400a0",
      "tues": "000000a001a400be025800a0025800a003fc00be056400a0",
      "workMode": "0",
      "curTargetTemp": 230,
      "switch": "on",
      "manTargetTemp": 230,
      "wed": "000000a001a400be025800a0025800a003fc00be056400a0",
      "thur": "000000a001a400be025800a0025800a003fc00be056400a0",
      "fri": "000000a001a400be025800a0025800a003fc00be056400a0",
      "sat": "000000a001a400be025800be025800be025800be056400a0",
      "sun": "000000a001a400be025800be025800be025800be056400a0",
      "autoTargetTemp": 190,
      "workState": "0"
    */

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    // The TRVZB supports a child lock, exposed as the lock physical controls characteristic
    if (!this.service.testCharacteristic(this.hapChar.LockPhysicalControls)) {
      this.service.addCharacteristic(this.hapChar.LockPhysicalControls)
    }
    this.service
      .getCharacteristic(this.hapChar.LockPhysicalControls)
      .onSet(async value => this.internalLockUpdate(value))

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
        maxValue: 3,
        validValues: [0, 1, 3],
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
    // value is 0 (off), 1 (heat), 3 (auto)
    // workMode for heat is 0, auto is 2
    try {
      const params = {}

      switch (value) {
        case 0:
          if (this.cacheMode === 'off') {
            return
          }

          // still not sure which params to send for "off"
          this.cacheMode = 'off'
          params.workMode = '1'
          break
        case 1:
        case 2:
          if (this.cacheMode === 'heat') {
            return
          }
          this.cacheMode = 'heat'
          params.workMode = '0'
          break
        case 3:
          if (this.cacheMode === 'auto') {
            return
          }
          this.cacheMode = 'auto'
          params.workMode = '2'
          break
        default:
          return
      }

      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.cacheMode)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetHeatingCoolingState,

          this.cacheMode === 'auto' ? 3 : (this.cacheMode === 'heat' ? 1 : 0),
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      const params = {}
      if (this.cacheMode === 'auto') {
        params.workMode = '2'
        params.autoTargetTemp = value * 10
      } else {
        params.workMode = '0'
        params.manTargetTemp = value * 10
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

  async internalLockUpdate(value) {
    try {
      const newLock = value === this.hapChar.LockPhysicalControls.CONTROL_LOCK_ENABLED
      if (newLock === this.cacheLock) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, { childLock: newLock })
      this.cacheLock = newLock
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curChildLock, newLock ? 'on' : 'off')
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.LockPhysicalControls,
          this.cacheLock
            ? this.hapChar.LockPhysicalControls.CONTROL_LOCK_ENABLED
            : this.hapChar.LockPhysicalControls.CONTROL_LOCK_DISABLED,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (hasProperty(params, 'childLock') && params.childLock !== this.cacheLock) {
        this.cacheLock = params.childLock
        this.service.updateCharacteristic(
          this.hapChar.LockPhysicalControls,
          this.cacheLock
            ? this.hapChar.LockPhysicalControls.CONTROL_LOCK_ENABLED
            : this.hapChar.LockPhysicalControls.CONTROL_LOCK_DISABLED,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curChildLock, this.cacheLock ? 'on' : 'off')
        }
      }
      if (hasProperty(params, 'workMode')) {
        let workMode
        let hkWorkMode
        switch (String(params.workMode)) {
          case '0':
            workMode = 'heat'
            hkWorkMode = 1
            break
          case '1':
            workMode = 'off'
            hkWorkMode = 0
            break
          // case '2':
          default:
            workMode = 'auto'
            hkWorkMode = 3
            break
        }
        if (this.cacheMode !== workMode) {
          this.cacheMode = workMode
          this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, hkWorkMode)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.cacheMode)
          }
        }
      }

      if (hasProperty(params, 'workState')) {
        const workState = String(params.workState) === '1' ? 'on' : 'off'
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

      // Handle target temp from curTargetTemp, manTargetTemp, or autoTargetTemp
      const rawTarget = params.curTargetTemp ?? params.manTargetTemp ?? params.autoTargetTemp
      if (rawTarget !== undefined) {
        const targetTemp = Number(rawTarget) / 10
        if (this.cacheTarg !== targetTemp) {
          this.cacheTarg = targetTemp
          this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s°C].', this.name, this.lang.curTarg, this.cacheTarg)
          }
        }
      }

      if (hasProperty(params, 'temperature')) {
        let currentTemp = Number(params.temperature) / 10
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
