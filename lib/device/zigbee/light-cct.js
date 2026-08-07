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
    this.alShift = deviceConf.adaptiveLightingShift || platformConsts.defaultValues.adaptiveLightingShift

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

    // Different bulbs have different colour temperature ranges
    this.minK = 2200
    this.maxK = 4000

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
      const params = {
        switch: 'on',
        brightness: value,
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

  async internalCTUpdate(value) {
    try {
      if (this.cacheMired === value) {
        return
      }
      if (
        this.accessory.alController
        && this.accessory.alController.isAdaptiveLightingActive()
        && (this.cacheState !== 'on' || !this.isOnline)
      ) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKeyCT = updateKey
      await sleep(400)
      if (updateKey !== this.updateKeyCT) {
        return
      }
      const kelvin = Math.round(1000000 / value)
      const scaledK = Math.max(Math.min(kelvin, this.maxK), this.minK)
      const scaledCT = Math.round(((scaledK - this.minK) / (this.maxK - this.minK)) * 100)
      const params = {
        switch: 'on',
        colorTemp: scaledCT,
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheMired = value
      this.cacheCT = scaledCT
      if (this.enableLogging) {
        if (this.accessory.alController && this.accessory.alController.isAdaptiveLightingActive()) {
          this.log('[%s] %s [%sK] %s.', this.name, this.lang.curColour, scaledK, this.lang.viaAL)
        } else {
          this.log('[%s] %s [%sK].', this.name, this.lang.curColour, scaledK)
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
      if (hasProperty(params, 'brightness')) {
        if (params.brightness !== this.cacheBright) {
          this.cacheBright = params.brightness
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
          }
        }
      }
      if (hasProperty(params, 'colorTemp')) {
        if (params.colorTemp !== this.cacheCT) {
          const ctDiff = Math.abs(params.colorTemp - this.cacheCT)
          this.cacheCT = params.colorTemp
          const kelvin = (this.cacheCT / 100) * (this.maxK - this.minK) + this.minK
          const scaledK = Math.round(kelvin)
          this.cacheMired = Math.min(Math.max(Math.round(1000000 / scaledK), 140), 500)
          this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
          if (params.updateSource) {
            if (this.enableLogging) {
              this.log('[%s] %s [%sK].', this.name, this.lang.curColour, scaledK)
            }
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
