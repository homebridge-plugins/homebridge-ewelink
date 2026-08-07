import {
  hs2rgb,
  k2rgb,
  m2hs,
  rgb2hs,
} from '../utils/colour.js'
import platformConsts from '../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
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
    this.alShift = deviceConf.adaptiveLightingShift || platformConsts.defaultValues.adaptiveLightingShift
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep
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
        this.enableDebugLogging = platform.config.debug
        break
    }

    // If the accessory has a outlet service then remove it (remedies bug int in v5)
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
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

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async value => this.internalBrightnessUpdate(value))

    // Add the set handler to the lightbulb hue characteristic
    this.service
      .getCharacteristic(this.hapChar.Hue)
      .onSet(async value => this.internalColourUpdate(value))
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

    // Add the set handler to the lightbulb colour temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.ColorTemperature)
      .onSet(async value => this.internalCTUpdate(value))

    // This is needed as sometimes we need to send the brightness with a cct update
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value

    // If the device is the L2 then add the FestiveScene custom characteristic
    if (this.accessory.context.eweUIID === 137) {
      if (!this.service.testCharacteristic(this.cusChar.FestiveScene)) {
        this.service.addCharacteristic(this.cusChar.FestiveScene)
      }
      this.service.getCharacteristic(this.cusChar.FestiveScene).onSet(async (value) => {
        await this.internalSceneUpdate(16, value)
      })
    }

    // Set up the adaptive lighting controller if not disabled by user
    if (this.alShift !== -1) {
      this.accessory.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
      })
      this.accessory.configureController(this.accessory.alController)
    }

    /*
      Modes for the L2 light
      0 - rgb
      1 - rgb (we use this for colour, not sure what the diff is to 0
      2 - cct mode
      3 - some black/white mode
      4 - music mode:
        { "mode": 4, "rhythmMode": 0, "rhythmSensitive": 0 } -> Classic
        { "mode": 4, "rhythmMode": 1, "rhythmSensitive": 0 } -> Soft
        { "mode": 4, "rhythmMode": 2, "rhythmSensitive": 0 } -> Dynamic
        { "mode": 4, "rhythmMode": 3, "rhythmSensitive": 0 } -> Disco
      5 - DIY scene
      6 - Vibrant
      7 - Reading
      8 - Leisure
      9 - Sunrise
      10 - Sunshine
      11 - Radiant
      12 - Dream
      13 - Candle
      14 - Night
      15 - Sunny
      16 - Festive
      17 - Vivid
      18 - Work
      19 - Ocean
      20 - Creek
      21 - Gentle
      22 - Passive
      23 - Joy
      24 - Rainbow
      25 - Moonlight
      26 - Sunset
    */

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.On).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.On).value
      })
      this.service.getCharacteristic(this.hapChar.Brightness).onGet(() => {
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
      offlineAsOff: !!this.offlineAsOff,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheState === newValue) {
        return
      }
      const timerKey = generateRandomString(5)
      this.updateTimeout = timerKey
      setTimeout(() => {
        if (this.updateTimeout === timerKey) {
          this.updateTimeout = false
        }
      }, 5000)
      const params = { switch: newValue }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newValue
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
      if (this.accessory.context.eweUIID === 137 && this.cacheState === 'off') {
        this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
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
      if (this.cacheBright === value) {
        return
      }
      const updateKey = generateRandomString(5)
      this.updateKeyBright = updateKey
      await sleep(500)
      if (updateKey !== this.updateKeyBright) {
        return
      }
      let params
      this.updateTimeout = updateKey
      setTimeout(() => {
        if (this.updateTimeout === updateKey) {
          this.updateTimeout = false
        }
      }, 5000)
      switch (this.accessory.context.eweUIID) {
        case 33:
        case 59:
          // L1
          params = {
            mode: 1,
            bright: value,
          }
          break
        case 104:
          // B02-B-A60, B05-B-A60, GTLC104
          if (this.cacheMode === 'white') {
            params = {
              white: {
                br: value,
                ct: this.cacheCT,
              },
            }
          } else {
            params = {
              color: {
                br: value,
                r: this.cacheR,
                g: this.cacheG,
                b: this.cacheB,
              },
            }
          }
          break
        case 135:
        case 136:
          if (this.cacheMode === 'white') {
            params = {
              ltype: 'white',
              white: {
                br: value,
                ct: this.cacheCT,
              },
            }
          } else {
            params = {
              ltype: 'color',
              color: {
                br: value,
                r: this.cacheR,
                g: this.cacheG,
                b: this.cacheB,
              },
            }
          }
          break
        case 137:
        case 173:
          params = {
            bright: value,
          }
          break
        default:
          return
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
      if (this.cacheHue === value) {
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
      let params
      const sat = this.service.getCharacteristic(this.hapChar.Saturation).value
      const rgb = hs2rgb(value, sat)
      switch (this.accessory.context.eweUIID) {
        case 33:
        case 59:
        case 137:
        case 173:
          // L1/L2
          params = {
            mode: 1,
            colorR: rgb[0],
            colorG: rgb[1],
            colorB: rgb[2],
          }
          break
        case 104: {
          // B02-B-A60, B05-B-A60, GTLC104
          params = {
            color: {
              br: this.cacheBright,
              r: rgb[0],
              g: rgb[1],
              b: rgb[2],
            },
          }
          if (this.cacheMode !== 'color') {
            params.ltype = 'color'
          }
          break
        }
        case 135:
        case 136:
          params = {
            ltype: 'color',
            color: {
              br: this.cacheBright,
              r: rgb[0],
              g: rgb[1],
              b: rgb[2],
            },
          }
          break
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheHue = value;
      [this.cacheR, this.cacheG, this.cacheB] = rgb
      this.cacheMired = 0
      this.cacheCT = 0
      if ([104, 135, 136].includes(this.accessory.context.eweUIID)) {
        this.cacheMode = 'color'
      }
      if (this.enableLogging) {
        this.log(
          '[%s] %s [rgb %s].',
          this.name,
          this.lang.curColour,
          `${this.cacheR} ${this.cacheG} ${this.cacheB}`,
        )
      }
      if (this.accessory.context.eweUIID === 137) {
        this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
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
        && (this.cacheState !== 'on' || !this.isOnline)
      ) {
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
      const hs = m2hs(value)
      this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
      this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])
      const mToK = Math.max(Math.min(Math.round(1000000 / value), 6500), 2700)
      let scaledCT
      let params
      let newRGB
      switch (this.accessory.context.eweUIID) {
        case 33:
        case 59: {
          // L1
          scaledCT = Math.round(((mToK - 2700) / 3800) * 100)
          newRGB = k2rgb(mToK)
          params = {
            mode: 1,
            colorR: newRGB[0],
            colorG: newRGB[1],
            colorB: newRGB[2],
          }
          break
        }
        case 104: {
          // B02-B-A60, B05-B-A60, GTLC104
          scaledCT = Math.round(((mToK - 2700) / 3800) * 255)
          params = {
            white: {
              br: this.cacheBright,
              ct: scaledCT,
            },
          }
          if (this.cacheMode !== 'white') {
            params.ltype = 'white'
          }
          break
        }
        case 135:
        case 136:
          scaledCT = Math.round(((mToK - 2700) / 3800) * 100)
          params = {
            ltype: 'white',
            white: {
              br: this.cacheBright,
              ct: scaledCT,
            },
          }
          break
        case 137:
        case 173: {
          // L2
          scaledCT = 100 - Math.round(((mToK - 2700) / 3800) * 100)
          newRGB = k2rgb(mToK)
          params = {
            mode: 2,
            colorTemp: scaledCT,
          }
          break
        }
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheMired = value;
      [this.cacheHue] = hs
      this.cacheCT = scaledCT
      switch (this.accessory.context.eweUIID) {
        case 33:
        case 59:
        case 137:
        case 173: {
          // L1
          [this.cacheR, this.cacheG, this.cacheB] = newRGB
          break
        }
        case 104:
        case 135:
        case 136:
          this.cacheMode = 'white'
          break
        default:
          return
      }
      if (this.enableLogging) {
        if (this.accessory.alController && this.accessory.alController.isAdaptiveLightingActive()) {
          this.log('[%s] %s [%sK] %s.', this.name, this.lang.curColour, mToK, this.lang.viaAL)
        } else {
          this.log('[%s] %s [%sK].', this.name, this.lang.curColour, mToK)
        }
      }
      if (this.accessory.context.eweUIID === 137) {
        this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSceneUpdate(scene, value) {
    try {
      if (!value) {
        return
      }
      const timerKey = generateRandomString(5)
      this.updateTimeout = timerKey
      setTimeout(() => {
        if (this.updateTimeout === timerKey) {
          this.updateTimeout = false
        }
      }, 5000)
      const params = { mode: scene }
      if (this.cacheState === 'off') {
        params.switch = 'on'
        this.cacheState = 'on'
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.service.updateCharacteristic(this.hapChar.On, true)
      this.accessory.alController.disableAdaptiveLighting()
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curScene, 'festive')
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (this.updateTimeout) {
        return
      }
      if (params.switch && params.switch !== this.cacheState) {
        this.cacheState = params.switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
        if (this.accessory.context.eweUIID === 137 && this.cacheState === 'off') {
          this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
        }
      }
      let hs
      switch (this.accessory.context.eweUIID) {
        case 33:
        case 59:
        case 137:
        case 173:
          // L1/L2
          if (hasProperty(params, 'bright')) {
            if (params.bright !== this.cacheBright) {
              this.cacheBright = params.bright
              this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
              if (params.updateSource && this.enableLogging) {
                this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
              }
            }
          }
          if (hasProperty(params, 'colorR')) {
            if (this.accessory.context.eweUIID === 137) {
              this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
            }
            if (
              params.colorR !== this.cacheR
              || params.colorG !== this.cacheG
              || params.colorB !== this.cacheB
            ) {
              // A light repeating our own command back can land a unit or two
              // off. Beyond that, somebody set this colour themselves, outside
              // HomeKit - which nothing else notices, so adaptive lighting has
              // to be stopped here or it moves the light off that colour within
              // minutes. This used to add the three channels together and want
              // a total of 50 out of a possible 765, so a deliberate but subtle
              // choice was read as noise and ignored.
              const rgbDiff = Math.max(
                Math.abs(params.colorR - this.cacheR),
                Math.abs(params.colorG - this.cacheG),
                Math.abs(params.colorB - this.cacheB),
              )
              this.cacheR = params.colorR
              this.cacheG = params.colorG
              this.cacheB = params.colorB
              hs = rgb2hs(this.cacheR, this.cacheG, this.cacheB);
              [this.cacheHue] = hs
              this.cacheMired = 140
              this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
              this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])
              if (params.updateSource) {
                if (this.enableLogging) {
                  this.log(
                    '[%s] %s [rgb %s].',
                    this.name,
                    this.lang.curColour,
                    `${this.cacheR} ${this.cacheG} ${this.cacheB}`,
                  )
                }
                if (
                  this.accessory.alController
                  && this.accessory.alController.isAdaptiveLightingActive()
                  && rgbDiff > 5
                ) {
                  this.accessory.alController.disableAdaptiveLighting()
                  if (this.enableLogging) {
                    this.log('[%s] %s.', this.name, this.lang.disabledAL)
                  }
                }
              }
            }
          }
          if (hasProperty(params, 'colorTemp')) {
            if (this.accessory.context.eweUIID === 137) {
              this.service.updateCharacteristic(this.cusChar.FestiveScene, false)
            }
            if (params.colorTemp !== this.cacheCTRaw && params.mode === 2) {
              const ctDiff = Math.abs(params.colorTemp - this.cacheCTRaw)
              this.cacheCTRaw = params.colorTemp
              this.cacheCT = 100 - params.colorTemp
              const ctToK = Math.round((this.cacheCT / 100) * 3800 + 2700)
              this.cacheMired = Math.max(Math.min(Math.round(1000000 / ctToK), 500), 140)
              hs = m2hs(this.cacheMired);
              [this.cacheHue] = hs
              this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
              this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])
              this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
              if (params.updateSource) {
                if (this.enableLogging) {
                  this.log('[%s] %s [%sK].', this.name, this.lang.curColour, ctToK)
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
          if (this.accessory.context.eweUIID === 137 && params.mode === 16) {
            // Festive scene enabled
            this.accessory.alController.disableAdaptiveLighting()
            this.service.updateCharacteristic(this.cusChar.FestiveScene, true)
            if (this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curScene, 'festive')
            }
          }
          break
        case 104:
        case 135:
        case 136:
          // B02-B-A60, B05-B-A60, GTLC104
          if (params.ltype === 'color' && params.color) {
            if (hasProperty(params.color, 'br')) {
              if (params.color.br !== this.cacheBright) {
                this.cacheBright = params.color.br
                this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
                if (params.updateSource && this.enableLogging) {
                  this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
                }
              }
            }
            if (hasProperty(params.color, 'r')) {
              if (
                params.color.r !== this.cacheR
                || params.color.g !== this.cacheG
                || params.color.b !== this.cacheB
                || this.cacheMode !== 'color'
              ) {
                this.cacheMode = 'color'
                this.cacheR = params.color.r
                this.cacheG = params.color.g
                this.cacheB = params.color.b
                this.cacheMired = 140
                hs = rgb2hs(this.cacheR, this.cacheG, this.cacheB);
                [this.cacheHue] = hs
                this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
                this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
                this.service.updateCharacteristic(this.hapChar.Saturation, 100)
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
            if (
              params.updateSource
              && this.accessory.alController
              && this.accessory.alController.isAdaptiveLightingActive()
            ) {
              this.accessory.alController.disableAdaptiveLighting()
              if (this.enableLogging) {
                this.log('[%s] %s.', this.name, this.lang.disabledAL)
              }
            }
          }
          if (params.ltype === 'white' && params.white) {
            if (hasProperty(params.white, 'br')) {
              if (params.white.br !== this.cacheBright || this.cacheMode !== 'white') {
                this.cacheBright = params.white.br
                this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
                if (params.updateSource && this.enableLogging) {
                  this.log('[%s] %s [%s%].', this.name, this.lang.curBright, this.cacheBright)
                }
              }
            }
            if (hasProperty(params.white, 'ct') && params.white.ct !== this.cacheCT) {
              this.cacheMode = 'white'
              const ctDiff = Math.abs(params.white.ct - this.cacheCT)
              this.cacheCT = params.white.ct

              let ctToK
              switch (this.accessory.context.eweUIID) {
                case 135:
                case 136:
                  ctToK = Math.round((this.cacheCT / 100) * 3800 + 2700)
                  break
                default:
                  ctToK = Math.round((this.cacheCT / 255) * 3800 + 2700)
                  break
              }
              this.cacheMired = Math.max(Math.min(Math.round(1000000 / ctToK), 500), 140)
              hs = m2hs(this.cacheMired);
              [this.cacheHue] = hs
              this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
              this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])
              this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
              if (params.updateSource) {
                if (this.enableLogging) {
                  this.log('[%s] %s [%sK].', this.name, this.lang.curColour, ctToK)
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
          break
        default:
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
      colourmode: this.cacheMode === 'white' ? 'colourtemperature' : 'hue',
      hue: this.service.getCharacteristic(this.hapChar.Hue).value,
      saturation: this.service.getCharacteristic(this.hapChar.Saturation).value,
      colourtemperature: this.service.getCharacteristic(this.hapChar.ColorTemperature).value,
      adaptivelighting:
        this.accessory.alController && this.accessory.alController.isAdaptiveLightingActive()
          ? 'on'
          : 'off',
    }
    return toReturn
  }
}
