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
      The device does not provide a current humidity reading so
      we use a fan accessory to be able to control the on/off state
      and the modes (1, 2, 3) using a rotation speed of (33%, 66%, 99%)
    */

    // Add the fan service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fan) || this.accessory.addService(this.hapServ.Fan)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 33 })
      .onSet(async value => this.internalModeUpdate(value))

    // Conversion object eWeLink mode to text label
    this.mode2label = {
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
      const params = { switch: newState }
      if (newState === 'on') {
        params.state = this.cacheMode
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

  async internalModeUpdate(value) {
    try {
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }
      const params = {}
      const newState = value >= 1 ? 'on' : 'off'
      params.switch = newState
      let newMode
      if (value > 0) {
        if (value <= 33) {
          newMode = 1
        } else if (value <= 66) {
          newMode = 2
        } else {
          newMode = 3
        }
        if (this.cacheMode === newMode) {
          return
        }
        params.state = newMode
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (newState !== this.cacheState) {
        this.cacheState = newState
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (value === 0) {
        // Update the rotation speed back to the previous value (with the fan still off)
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 33)
        }, 2000)
        return
      }
      this.cacheMode = newMode
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.mode2label[this.cacheMode])
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 33)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (params.switch && params.switch !== this.cacheState) {
        this.cacheState = params.switch
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        if (this.cacheState !== 'on') {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, 0)
        }
      }
      if (params.state && params.state !== this.cacheMode) {
        this.cacheMode = params.state
        if (this.cacheState === 'on') {
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.mode2label[this.cacheMode])
          }
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 33)
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
