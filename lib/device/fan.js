import { generateRandomString, sleep } from '../utils/functions.js'

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
    this.hideLight = deviceConf.hideLight

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

    // Add the fan service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fan) || this.accessory.addService(this.hapServ.Fan)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 3,
        minStep: 1,
        minValue: 0,
        unit: 'unitless', // This is actually from HAP for Bluetooth LE Specification, but fits
      })
      .onSet(async value => this.internalSpeedUpdate(value))

    // Check to see if the user has hidden the light channel
    if (this.hideLight) {
      // The user has hidden the light channel, so remove it if it exists
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      // The user has not hidden the light channel, so add it if it doesn't exist
      this.lightService = this.accessory.getService(this.hapServ.Lightbulb)
        || this.accessory.addService(this.hapServ.Lightbulb)

      // Add the set handler to the lightbulb on/off characteristic
      this.lightService
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => this.internalLightUpdate(value))
    }

    // Set the fan service to the primary service
    this.service.setPrimaryService()

    // Conversion object eWeLink mode to text label
    this.speed2label = {
      1: 'low',
      2: 'medium',
      3: 'high',
    }

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.On).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.On).value
      })
      this.service.getCharacteristic(this.hapChar.RotationSpeed).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      })
      if (this.lightService) {
        this.lightService.getCharacteristic(this.hapChar.On).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.lightService.getCharacteristic(this.hapChar.On).value
        })
      }
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      hideLight: this.hideLight,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newState = value ? 'on' : 'off'
      if (newState === this.cacheState) {
        return
      }
      const params = {
        switches: [],
      }
      params.switches.push({
        switch: newState,
        outlet: 1,
      })
      if (newState === 'on') {
        params.switches.push({
          switch: this.cacheSpeed === 2 ? 'on' : 'off',
          outlet: 2,
        })
        params.switches.push({
          switch: this.cacheSpeed === 3 ? 'on' : 'off',
          outlet: 3,
        })
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newState
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, newState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the slider
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }
      const params = {
        switches: [],
      }
      const newState = value >= 1 ? 'on' : 'off'
      let newSpeed

      if (value < 0 || value > 3) {
        newSpeed = 0
      } else {
        newSpeed = value
      }
      if (newSpeed === this.cacheSpeed) {
        return
      }
      params.switches.push({
        switch: newState === 'on' && newSpeed >= 1 ? 'on' : 'off',
        outlet: 1,
      })
      params.switches.push({
        switch: newState === 'on' && newSpeed === 2 ? 'on' : 'off',
        outlet: 2,
      })
      params.switches.push({
        switch: newState === 'on' && newSpeed === 3 ? 'on' : 'off',
        outlet: 3,
      })
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (newState !== this.cacheState) {
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (newSpeed === 0) {
        // Update the rotation speed back to the previous value (with the fan still off)
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
        }, 2000)
        return
      }
      this.cacheSpeed = newSpeed
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curSpeed, this.speed2label[this.cacheSpeed])
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightUpdate(value) {
    try {
      const params = {
        switches: [],
      }
      const newLight = value ? 'on' : 'off'
      if (newLight === this.cacheLight) {
        return
      }
      params.switches.push({
        switch: newLight,
        outlet: 0,
      })
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheLight = newLight
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curLight, this.cacheLight)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLight === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (params.light && params.fan && params.speed) {
        // LAN update from iFan03
        params.switches = {}
        params.switches[0] = { switch: params.light }
        params.switches[1] = { switch: params.fan }
        switch (params.speed) {
          case 1:
            params.switches[2] = { switch: 'off' }
            params.switches[3] = { switch: 'off' }
            break
          case 2:
            params.switches[2] = { switch: 'on' }
            params.switches[3] = { switch: 'off' }
            break
          case 3:
            params.switches[2] = { switch: 'off' }
            params.switches[3] = { switch: 'on' }
            break
          default:
            return
        }
      }
      if (!params.switches || !params.switches[1] || !params.switches[2] || !params.switches[3]) {
        return
      }
      if (params.switches[1].switch !== this.cacheState) {
        this.cacheState = params.switches[1].switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      let speed
      switch (params.switches[2].switch + params.switches[3].switch) {
        case 'onoff':
          speed = 2
          break
        case 'offon':
          speed = 3
          break
        default:
          speed = 1
          break
      }
      if (speed !== this.cacheSpeed && this.cacheState === 'on') {
        this.cacheSpeed = speed
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
        if (params.updateSource && this.enableLogging) {
          this.log(
            '[%s] %s [%s].',
            this.name,
            this.lang.curSpeed,
            this.speed2label[this.cacheSpeed],
          )
        }
      }
      if (this.lightService && params.switches[0].switch !== this.cacheLight) {
        this.cacheLight = params.switches[0].switch
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLight === 'on')
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curLight, this.cacheLight)
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  currentState() {
    const toReturn = {}
    let speedLabel
    const speed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    if (speed === 0) {
      speedLabel = 'off'
    } else if (speed <= 1) {
      speedLabel = 'low'
    } else if (speed <= 2) {
      speedLabel = 'medium'
    } else {
      speedLabel = 'high'
    }
    toReturn.services = ['fan']
    toReturn.fan = {
      state: this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
      speed: speedLabel,
    }
    if (!this.hideLight) {
      toReturn.services.push('light')
      toReturn.light = {
        state: this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
      }
    }
    return toReturn
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
