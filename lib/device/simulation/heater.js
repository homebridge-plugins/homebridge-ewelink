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
        this.enableDebugLogging = false
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
    if (this.accessory.context.cacheType !== 'heater') {
      // Remove and re-setup as a HeaterCooler
      if (this.accessory.getService(this.hapServ.HeaterCooler)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
      }
      this.accessory.context.cacheType = 'heater'
      this.accessory.context.cacheTarget = 20
    }

    // Set up the device type and power readings if necessary
    if (platformConsts.devices.switchSingle.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchSingle'
    } else if (platformConsts.devices.switchSinglePower.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchSingle'
    } else if (platformConsts.devices.switchMulti.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchMulti'
    } else if (platformConsts.devices.switchSCM.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchMulti'
    } else if (platformConsts.devices.switchSCMPower.includes(this.accessory.context.eweUIID)) {
      this.setup = 'switchMulti'
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
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
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
      this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
      })
    }

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'
    this.cacheHeat = this.cacheState === 'on'
      && this.service.getCharacteristic(this.hapChar.CurrentHeaterCoolerState).value === 2
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

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'heater',
      temperatureSource: this.temperatureSource,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      let newState
      let newHeat
      const params = {}
      if (value === 0) {
        if (this.setup === 'switchSingle') {
          params.switch = 'off'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'off',
              outlet: 0,
            },
          ]
        }
        newState = 'off'
        newHeat = 'off'
      } else if (this.cacheTemp < this.accessory.context.cacheTarget) {
        if (this.setup === 'switchSingle') {
          params.switch = 'on'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'on',
              outlet: 0,
            },
          ]
        }
        newState = 'on'
        newHeat = 'on'
      } else {
        if (this.setup === 'switchSingle') {
          params.switch = 'off'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'off',
              outlet: 0,
            },
          ]
        }
        newState = 'on'
        newHeat = 'off'
      }

      // Only send the update if either:
      // * The new value (state) is OFF and the cacheHeat was ON
      // * The new value (state) is ON and newHeat is 'on'
      if ((value === 0 && this.cacheHeat === 'on') || (value === 1 && newHeat === 'on')) {
        await this.platform.sendDeviceUpdate(this.accessory, params)
      }
      if (newState !== this.cacheState) {
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (newHeat !== this.cacheHeat) {
        this.cacheHeat = newHeat
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
        }
      }
      const hapState = this.cacheHeat === 'on' ? 2 : 1
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
      let newHeat
      if (this.cacheTemp < value) {
        if (this.setup === 'switchSingle') {
          params.switch = 'on'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'on',
              outlet: 0,
            },
          ]
        }
        newHeat = 'on'
      } else {
        if (this.setup === 'switchSingle') {
          params.switch = 'off'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'off',
              outlet: 0,
            },
          ]
        }
        newHeat = 'off'
      }
      if (newHeat === this.cacheHeat) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHeat = newHeat
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        this.cacheHeat === 'on' ? 2 : 1,
      )
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.HeatingThresholdTemperature,
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
      let newHeat
      if (this.cacheTemp < this.accessory.context.cacheTarget) {
        if (this.setup === 'switchSingle') {
          params.switch = 'on'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'on',
              outlet: 0,
            },
          ]
        }
        newHeat = 'on'
      } else {
        if (this.setup === 'switchSingle') {
          params.switch = 'off'
        } else { // switchMulti
          params.switches = [
            {
              switch: 'off',
              outlet: 0,
            },
          ]
        }
        newHeat = 'off'
      }
      if (newHeat === this.cacheHeat) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHeat = newHeat
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curHeat, this.cacheHeat)
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeaterCoolerState,
        this.cacheHeat === 'on' ? 2 : 1,
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

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
