import { generateRandomString, sleep } from '../utils/functions.js'

/*
  UIID 17: the "three gear fan", controlled with named params rather than
  switch channels (matching AlexxIT/SonoffLAN's XFan17):
  - fan: 'on'/'off'
  - speed: 'slow'/'moderate'/'fast'
  - shake: 'on'/'off' (oscillation)
*/
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

    // Conversion objects between eWeLink speed labels and HomeKit values
    this.speed2value = {
      slow: 1,
      moderate: 2,
      fast: 3,
    }
    this.value2speed = {
      1: 'slow',
      2: 'moderate',
      3: 'fast',
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

    // Add the set handler to the fan swing mode (oscillation) characteristic
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalShakeUpdate(value))

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
      this.service.getCharacteristic(this.hapChar.SwingMode).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.SwingMode).value
      })
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
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
      await this.platform.sendDeviceUpdate(this.accessory, { fan: newState })
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
      if (value === 0) {
        // A zero speed value means turning the fan off
        await this.platform.sendDeviceUpdate(this.accessory, { fan: 'off' })
        this.cacheState = 'off'
        if (this.enableLogging) {
          this.log('[%s] %s [off].', this.name, this.lang.curState)
        }
        return
      }
      const newSpeed = this.value2speed[value]
      if (newSpeed === this.cacheSpeed) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, { fan: 'on', speed: newSpeed })
      this.cacheState = 'on'
      this.cacheSpeed = newSpeed
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curSpeed, newSpeed)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.RotationSpeed,
          this.speed2value[this.cacheSpeed] || 0,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalShakeUpdate(value) {
    try {
      const newShake = value === this.hapChar.SwingMode.SWING_ENABLED ? 'on' : 'off'
      if (newShake === this.cacheShake) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, { shake: newShake })
      this.cacheShake = newShake
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curOscillation, newShake)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.SwingMode,
          this.cacheShake === 'on'
            ? this.hapChar.SwingMode.SWING_ENABLED
            : this.hapChar.SwingMode.SWING_DISABLED,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (params.fan && params.fan !== this.cacheState) {
        this.cacheState = params.fan
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (params.speed && params.speed !== this.cacheSpeed && this.speed2value[params.speed]) {
        this.cacheSpeed = params.speed
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.speed2value[this.cacheSpeed])
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curSpeed, this.cacheSpeed)
        }
      }
      if (params.shake && params.shake !== this.cacheShake) {
        this.cacheShake = params.shake
        this.service.updateCharacteristic(
          this.hapChar.SwingMode,
          this.cacheShake === 'on'
            ? this.hapChar.SwingMode.SWING_ENABLED
            : this.hapChar.SwingMode.SWING_DISABLED,
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
