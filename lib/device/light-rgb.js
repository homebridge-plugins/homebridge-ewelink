import { hs2rgb, rgb2hs } from '../utils/colour.js'
import { generateRandomString, hasProperty, sleep } from '../utils/functions.js'

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
    this.offlineAsOff = deviceConf.offlineAsOff

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

    // Add the lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: 100 })
      .onSet(async value => this.internalBrightnessUpdate(value))

    // Add the set handler to the lightbulb hue characteristic
    this.service
      .getCharacteristic(this.hapChar.Hue)
      .onSet(async value => this.internalColourUpdate(value))

    // Saturation needs a handler of its own. HomeKit writes saturation first and
    // hue second, so with no handler here a change that moves only the saturation
    // - vivid red to pale pink - sent nothing at all and the bulb kept the old
    // colour while HomeKit showed the new one.
    this.service
      .getCharacteristic(this.hapChar.Saturation)
      .onSet(async () => {
        await this.internalColourUpdate(this.service.getCharacteristic(this.hapChar.Hue).value)
      })
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.On).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.On).value
      })
      this.service
        .getCharacteristic(this.hapChar.Brightness)
        .onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return this.service.getCharacteristic(this.hapChar.Brightness).value
        })
      this.service.getCharacteristic(this.hapChar.Hue).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.Hue).value
      })
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      offlineAsOff: !!this.offlineAsOff,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const params = {}
      const newValue = value ? 'on' : 'off'
      if (this.cacheState === newValue) {
        return
      }
      params.state = newValue
      const timerKey = generateRandomString(5)
      this.updateTimeout = timerKey
      setTimeout(() => {
        if (this.updateTimeout === timerKey) {
          this.updateTimeout = false
        }
      }, 5000)
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newValue
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // B1 doesn't support brightness
      this.cacheBright = value
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate(value) {
    try {
      // Saturation is part of "has the colour changed": comparing hue alone
      // dropped a saturation-only change
      const currentSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      if (this.cacheHue === value && this.cacheSat === currentSat) {
        return
      }
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(400)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }
      this.updateTimeout = updateKeyColour
      setTimeout(() => {
        if (this.updateTimeout === updateKeyColour) {
          this.updateTimeout = false
        }
      }, 5000)
      const saturation = this.service.getCharacteristic(this.hapChar.Saturation).value
      const newRGB = hs2rgb(value, saturation)
      const params = {
        zyx_mode: 2,
        type: 'middle',
        channel0: '0',
        channel1: '0',
        channel2: newRGB[0].toString(),
        channel3: newRGB[1].toString(),
        channel4: newRGB[2].toString(),
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHue = value
      this.cacheSat = saturation;
      [this.cacheR, this.cacheG, this.cacheB] = newRGB
      if (this.enableLogging) {
        this.log(
          '[%s] %s [rgb %s].',
          this.name,
          this.lang.curColour,
          `${this.cacheR} ${this.cacheG} ${this.cacheB}`,
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (this.updateTimeout) {
        return
      }
      if (params.state && params.state !== this.cacheState) {
        this.cacheState = params.state
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        this.service.updateCharacteristic(
          this.hapChar.Brightness,
          this.cacheState === 'on' ? 100 : 0,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      let hs
      let mode
      if (params.zyx_mode) {
        mode = Number.parseInt(params.zyx_mode, 10)
      } else if (
        hasProperty(params, 'channel0')
        && Number.parseInt(params.channel0, 10) + Number.parseInt(params.channel1, 10) > 0
      ) {
        mode = 1
      } else {
        mode = 2
      }
      if (mode === 2) {
        if (hasProperty(params, 'channel2')) {
          if (
            params.channel2 !== (this.cacheR || 0).toString()
            || params.channel3 !== (this.cacheG || 0).toString()
            || params.channel4 !== (this.cacheB || 0).toString()
          ) {
            this.cacheR = Number.parseInt(params.channel2, 10)
            this.cacheG = Number.parseInt(params.channel3, 10)
            this.cacheB = Number.parseInt(params.channel4, 10)
            hs = rgb2hs(this.cacheR, this.cacheG, this.cacheB);
            [this.cacheHue, this.cacheSat] = hs
            this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
            // Saturation was pinned at 100 here, so a pale colour set in the
            // ewelink app came back to HomeKit as a fully saturated one
            this.service.updateCharacteristic(this.hapChar.Saturation, this.cacheSat)
            this.service.updateCharacteristic(this.hapChar.Brightness, 100)
            if (params.updateSource && this.enableLogging) {
              this.log(
                '[%s] %s [rgb %s].',
                this.name,
                this.lang.curColour,
                `${this.cacheR} ${this.cacheG} ${this.cacheB}`,
              )
            }
          }
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline

    // Show as off if offlineAsOff is enabled
    if (this.offlineAsOff && !isOnline && this.cacheState !== 'off') {
      this.service.updateCharacteristic(this.hapChar.On, false)
      this.cacheState = 'off'
      if (this.enableLogging) {
        this.log('[%s] %s [%s - offline]', this.name, this.lang.curState, this.cacheState)
      }
    }
  }

  currentState() {
    const toReturn = {}
    toReturn.services = ['light']
    toReturn.light = {
      state: this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
      brightness: this.service.getCharacteristic(this.hapChar.Brightness).value,
      hue: this.service.getCharacteristic(this.hapChar.Hue).value,
      saturation: this.service.getCharacteristic(this.hapChar.Saturation).value,
    }
    return toReturn
  }
}
