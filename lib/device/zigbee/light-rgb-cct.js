import { m2hs } from '../../utils/colour.js'
import platformConsts from '../../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../../utils/functions.js'

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

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep

    // Different bulbs have different colour temperature ranges
    this.minK = 2700
    this.maxK = 6500

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

    // Add the lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Adaptive lighting has just been switched off, so take away the three
    // characteristics that make Home offer it. Only these need to go: the whole
    // Lightbulb service used to be thrown away and rebuilt here, which does hide
    // the icon but presents Home with what looks like a different light, and an
    // owner can lose that light's room and its automations as a result.
    if (this.alShift === -1 && this.accessory.context.adaptiveLighting) {
      [
        'SupportedCharacteristicValueTransitionConfiguration',
        'CharacteristicValueTransitionControl',
        'CharacteristicValueActiveTransitionCount',
      ].forEach((charName) => {
        const char = this.hapChar[charName]
        if (char && this.service.testCharacteristic(char)) {
          this.service.removeCharacteristic(this.service.getCharacteristic(char))
        }
      })
      this.accessory.context.adaptiveLighting = false
    }

    // Add the get/set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async value => this.internalBrightnessUpdate(value))

    // This is needed as sometimes we need to send the brightness with a cct update
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value

    // Add the set handler to the lightbulb hue characteristic
    this.service
      .getCharacteristic(this.hapChar.Hue)
      .onSet(async value => this.internalColourUpdate(value))

    // Saturation needs a handler of its own. HomeKit writes hue and saturation
    // separately, so with only hue listened for, dragging saturation alone -
    // the same colour made paler or richer - reached nothing and the light
    // never changed. Both handlers share one update, and the debounce inside
    // it collapses a hue-and-saturation pair into a single command.
    this.service
      .getCharacteristic(this.hapChar.Saturation)
      .onSet(async () => this.internalColourUpdate(this.service.getCharacteristic(this.hapChar.Hue).value))
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

    // Add the set handler to the lightbulb colour temperature characteristic
    this.service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async value => this.internalCTUpdate(value))

    // Set up the adaptive lighting controller if not disabled by user
    if (this.alShift !== -1) {
      this.accessory.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
      })
      this.accessory.configureController(this.accessory.alController)
      // Without this the cleanup that removes the adaptive lighting
      // characteristics can never run, because it is guarded on this flag - so
      // switching adaptive lighting off left Home still offering it.
      this.accessory.context.adaptiveLighting = true
    }

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
      this.service.getCharacteristic(this.hapChar.ColorTemperature).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.ColorTemperature).value
      })
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      adaptiveLightingShift: this.alShift,
      brightnessStep: this.brightStep,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      await this.platform.sendDeviceUpdate(this.accessory, {
        switch: newValue,
      })
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
      if (this.cacheBright === value || value === 0) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKeyBright = updateKey
      await sleep(500)
      if (updateKey !== this.updateKeyBright) {
        return
      }
      const params = {}
      switch (this.cacheMode) {
        case 'color':
          params.rgbBrightness = value
          break
        case 'white':
          params.cctBrightness = value
          break
        default:
          throw new Error('Color mode not set')
      }

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
      // meant a change of saturation at the same hue looked like no change at
      // all, and nothing was sent to the light.
      const currentSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      if (this.cacheHue === value && this.cacheSat === currentSat) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(400)
      if (updateKey !== this.updateKey) {
        return
      }
      this.updateTimeout = updateKey
      setTimeout(() => {
        if (this.updateTimeout === updateKey) {
          this.updateTimeout = false
        }
      }, 5000)
      this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
      const params = {
        hue: value,
        saturation: this.cacheSat,
      }
      if (this.cacheMode !== 'color') {
        params.colorMode = 'rgb'
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHue = value
      this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      this.cacheMired = 0
      this.cacheCT = 0
      this.cacheMode = 'color'
      if (this.enableLogging) {
        this.log(
          '[%s] %s [hue %s saturation %s].',
          this.name,
          this.lang.curColour,
          `${this.cacheHue} ${this.cacheSat}`,
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
      if (this.cacheMired === value) {
        return
      }
      if (
        this.accessory.alController
        && this.accessory.alController.isAdaptiveLightingActive()
        && (this.cacheState !== 'on')
      ) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKeyCT = updateKey
      await sleep(400)
      if (updateKey !== this.updateKeyCT) {
        return
      }
      const hs = m2hs(value)
      this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
      this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])
      const mToK = Math.max(Math.min(Math.round(1000000 / value), 6500), 2700)
      const kelvin = Math.round(1000000 / value)
      const scaledK = Math.max(Math.min(kelvin, this.maxK), this.minK)
      const scaledCT = Math.round(((scaledK - this.minK) / (this.maxK - this.minK)) * 100)
      const params = {
        colorTemp: scaledCT,
      }
      if (this.cacheMode !== 'white') {
        params.colorMode = 'cct'
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheMired = value
      this.cacheCT = scaledCT
      if (this.enableLogging) {
        if (this.accessory.alController && this.accessory.alController.isAdaptiveLightingActive()) {
          this.log('[%s] %s [%sK] %s.', this.name, this.lang.curColour, mToK, this.lang.viaAL)
        } else {
          this.log('[%s] %s [%sK].', this.name, this.lang.curColour, mToK)
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (params.switch && params.switch !== this.cacheState) {
        this.cacheState = params.switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }

      // How to tell which mode the bulb is in
      // params.colorMode can be "rgb" or "cct"
      // params.rgbBrightness is the brightness of the bulb when in rgb mode 0-100
      // params.cctBrightness is the brightness of the bulb when in cct mode 0-100
      // params.colorTemp is the colour temperature of the bulb when in cct mode 0-100
      // params.hue is the hue of the bulb when in rgb mode 0-360
      // params.saturation is the saturation of the bulb when in rgb mode 0-100
      // when the plugin first loads we will have all the info

      if (
        params.colorMode === 'rgb'
        || (
          this.cacheMode === 'color'
          && (
            hasProperty(params, 'rgbBrightness')
            || hasProperty(params, 'hue')
            || hasProperty(params, 'saturation')
          )
        )
      ) {
        this.cacheMode = 'color'
        if (
          this.accessory.alController
          && this.accessory.alController.isAdaptiveLightingActive()
        ) {
          this.accessory.alController.disableAdaptiveLighting()
          if (this.enableLogging) {
            this.log('[%s] %s.', this.name, this.lang.disabledAL)
          }
        }

        if (hasProperty(params, 'rgbBrightness') && params.rgbBrightness !== this.cacheBright) {
          this.cacheBright = params.rgbBrightness
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
          }
          this.cacheBright = params.rgbBrightness
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }
        if (
          (hasProperty(params, 'hue') && params.hue !== this.cacheHue)
          || (hasProperty(params, 'saturation') && params.saturation !== this.cacheSat)
        ) {
          this.cacheHue = hasProperty(params, 'hue') ? params.hue : this.cacheHue
          this.cacheSat = hasProperty(params, 'saturation') ? params.saturation : this.cacheSat
          this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
          this.service.updateCharacteristic(this.hapChar.Saturation, this.cacheSat)
          if (params.updateSource && this.enableLogging) {
            this.log(
              '[%s] %s [hue %s saturation %s].',
              this.name,
              this.lang.curColour,
              `${this.cacheHue} ${this.cacheSat}`,
            )
          }
        }
      } else if (
        params.colorMode === 'cct'
        || (
          this.cacheMode === 'white'
          && (
            hasProperty(params, 'cctBrightness')
            || hasProperty(params, 'colorTemp')
          )
        )
      ) {
        this.cacheMode = 'white'
        if (hasProperty(params, 'cctBrightness') && params.cctBrightness !== this.cacheBright) {
          this.cacheBright = params.cctBrightness
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
          }
        }
        if (hasProperty(params, 'colorTemp') && params.colorTemp !== this.cacheCT) {
          const ctDiff = Math.abs(params.colorTemp - this.cacheCT)
          this.cacheCT = params.colorTemp
          const kelvin = Math.round(((this.cacheCT / 100) * (this.maxK - this.minK)) + this.minK)
          this.cacheMired = Math.round(1000000 / kelvin)
          this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
          if (
            this.accessory.alController
            && this.accessory.alController.isAdaptiveLightingActive()
            && ctDiff > 20
          ) {
            // Look for a variation greater than twenty
            this.accessory.alController.disableAdaptiveLighting()
            if (this.enableLogging) {
              this.log('[%s] %s.', this.name, this.lang.disabledAL)
            }
          }
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%sK].', this.name, this.lang.curColour, kelvin)
          }
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
