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

    // The B1 dims in white mode, with channel0 (cold) and channel1 (warm) from
    // 25 to 255, and has three white tones: cold, middle and warm. CoolKit's
    // protocol gives no brightness for colour mode, so there it scales the RGB
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: 1 })
      .onSet(async value => this.internalBrightnessUpdate(value))
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value || 100

    // Add the set handler to the lightbulb colour temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.ColorTemperature)
      .onSet(async value => this.internalCTUpdate(value))

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
      if (value === 0 || this.cacheBright === value) {
        return
      }
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(500)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }
      this.updateTimeout = updateKeyBright
      setTimeout(() => {
        if (this.updateTimeout === updateKeyBright) {
          this.updateTimeout = false
        }
      }, 5000)
      const params = this.cacheMode === 2
        ? this.colourParams(this.cacheHue, this.cacheSat, value)
        : this.whiteParams(this.cacheType, value)
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheBright = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
      }
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
      const params = this.colourParams(value, saturation, this.cacheBright)
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHue = value
      this.cacheSat = saturation
      this.cacheMode = 2
      this.cacheR = Number(params.channel2)
      this.cacheG = Number(params.channel3)
      this.cacheB = Number(params.channel4)
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

  async internalCTUpdate(value) {
    try {
      // HomeKit's mireds, from 140 (cold) to 500 (warm), onto the three tones
      const newType = value < 250
        ? 'cold'
        : value > 370
          ? 'warm'
          : 'middle'
      if (this.cacheMode === 1 && this.cacheType === newType) {
        return
      }
      const updateKeyCT = generateRandomString(5)
      this.updateKeyCT = updateKeyCT
      await sleep(400)
      if (updateKeyCT !== this.updateKeyCT) {
        return
      }
      this.updateTimeout = updateKeyCT
      setTimeout(() => {
        if (this.updateTimeout === updateKeyCT) {
          this.updateTimeout = false
        }
      }, 5000)
      await this.platform.sendDeviceUpdate(this.accessory, this.whiteParams(newType, this.cacheBright))
      this.cacheType = newType
      this.cacheMode = 1
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curColour, newType)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      throw new this.hapErr(-70402)
    }
  }

  // The white light, with HomeKit's 1-100 brightness on the channels' 25-255
  whiteParams(type = 'middle', brightness = 100) {
    const level = String(Math.round(25 + ((Math.max(brightness, 1) - 1) / 99) * 230))
    return {
      zyx_mode: 1,
      type,
      channel0: type === 'warm'
        ? '0'
        : level,
      channel1: type === 'cold'
        ? '0'
        : level,
    }
  }

  // A colour, with the brightness scaling the RGB, as colour mode has no brightness
  colourParams(hue = 0, saturation = 100, brightness = 100) {
    const scale = Math.max(brightness, 1) / 100
    const rgb = hs2rgb(hue, saturation).map(x => Math.round(x * scale))
    return {
      zyx_mode: 2,
      type: 'middle',
      channel0: '0',
      channel1: '0',
      channel2: rgb[0].toString(),
      channel3: rgb[1].toString(),
      channel4: rgb[2].toString(),
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
      if (mode === 1 && hasProperty(params, 'channel0')) {
        const cold = Number.parseInt(params.channel0, 10) || 0
        const warm = Number.parseInt(params.channel1, 10) || 0
        const level = Math.max(cold, warm)
        const type = cold > warm
          ? 'cold'
          : cold < warm
            ? 'warm'
            : 'middle'
        this.cacheMode = 1
        if (level >= 25) {
          const bright = Math.min(Math.max(Math.round(((level - 25) / 230) * 99 + 1), 1), 100)
          if (bright !== this.cacheBright) {
            this.cacheBright = bright
            this.service.updateCharacteristic(this.hapChar.Brightness, bright)
          }
        }
        if (type !== this.cacheType) {
          this.cacheType = type
          // 6500K, 4000K and 2700K
          const mired = { cold: 154, middle: 250, warm: 370 }[type]
          this.service.updateCharacteristic(this.hapChar.ColorTemperature, mired)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curColour, type)
          }
        }
      }
      if (mode === 2) {
        this.cacheMode = 2
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
            // The brightest channel gives the brightness the colour was scaled by
            const max = Math.max(this.cacheR, this.cacheG, this.cacheB)
            if (max > 0) {
              this.cacheBright = Math.max(Math.round((max / 255) * 100), 1)
              this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
            }
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
      state: this.service.getCharacteristic(this.hapChar.On).value
        ? 'on'
        : 'off',
      brightness: this.service.getCharacteristic(this.hapChar.Brightness).value,
      hue: this.service.getCharacteristic(this.hapChar.Hue).value,
      saturation: this.service.getCharacteristic(this.hapChar.Saturation).value,
    }
    return toReturn
  }
}
