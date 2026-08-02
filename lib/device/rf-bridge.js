import axios from 'axios'

import platformConsts from '../utils/constants.js'
import { hasProperty, parseError, sleep } from '../utils/functions.js'

const rfTrigRegex = /rfTrig/

export default class {
  constructor(platform, accessory, devicesInHB) {
    // Set up variables from the platform
    this.devicesInHB = devicesInHB
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.eveChar = platform.eveChar
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
    const { resetOnStartup } = deviceConf

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

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      resetOnStartup,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    try {
      if (!hasProperty(params, 'updateSource')) {
        return
      }
      const timeNow = new Date()
      let subAccessory = false
      let channel
      if (
        hasProperty(params, 'cmd')
        && params.cmd === 'transmit'
        && hasProperty(params, 'rfChl')
      ) {
        // RF Button
        this.devicesInHB.forEach((acc) => {
          if (
            acc.context.eweDeviceId === this.accessory.context.eweDeviceId
            && hasProperty(acc.context, 'buttons')
            && hasProperty(acc.context.buttons, params.rfChl.toString())
          ) {
            subAccessory = acc
          }
        })
        if (subAccessory) {
          const deviceConf = this.platform.rfSubdevices[subAccessory.context.hbDeviceId]
          let enableLogging
          switch (deviceConf.overrideLogging) {
            case 'standard':
            case 'debug':
              enableLogging = true
              break
            case 'disable':
              enableLogging = false
              break
            default:
              enableLogging = !this.disableDeviceLogging
              break
          }
          const service = subAccessory.context.buttons[params.rfChl]
          subAccessory.getService(service).updateCharacteristic(this.hapChar.On, true)
          if (params.updateSource && enableLogging) {
            this.log(
              '[%s] %s [%s].',
              subAccessory.displayName,
              this.lang.curState,
              this.lang.buttonTrig,
            )
          }
          await sleep(3000)
          subAccessory.getService(service).updateCharacteristic(this.hapChar.On, false)
        } else {
          throw new Error(this.lang.buttonNotFound)
        }
      } else if (
        (hasProperty(params, 'cmd') && params.cmd === 'trigger')
        || params.updateSource === 'LAN'
      ) {
        // RF Sensor
        Object.keys(params)
          .filter(name => rfTrigRegex.test(name))
          .forEach(async (chan) => {
            try {
              this.devicesInHB.forEach((acc) => {
                if (
                  acc.context.eweDeviceId === this.accessory.context.eweDeviceId
                  && hasProperty(acc.context, 'buttons')
                  && hasProperty(acc.context.buttons, chan.split('g')[1].toString())
                ) {
                  subAccessory = acc
                  channel = chan.split('g')[1].toString()
                }
              })
              if (subAccessory) {
                // Avoid duplicate triggers from LAN and WS
                if (params[chan] === subAccessory.context.cacheLastAct) {
                  return
                }
                const deviceConf = this.platform.rfSubdevices[subAccessory.context.hbDeviceId] || {}
                let enableLogging
                switch (deviceConf.overrideLogging) {
                  case 'standard':
                  case 'debug':
                    enableLogging = true
                    break
                  case 'disable':
                    enableLogging = false
                    break
                  default:
                    enableLogging = !this.disableDeviceLogging
                    break
                }
                switch (subAccessory.context.subType) {
                  case 'blind':
                  case 'door':
                  case 'window':
                    // Simulations don't support external updates
                    return
                  case 'button':
                  case 'curtain': {
                    const service = subAccessory.context.buttons[channel]
                    subAccessory.getService(service).updateCharacteristic(this.hapChar.On, true)
                    this.log(
                      '[%s] %s [%s].',
                      subAccessory.displayName,
                      this.lang.curState,
                      this.lang.buttonTrig,
                    )
                    await sleep(3000)
                    subAccessory.getService(service).updateCharacteristic(this.hapChar.On, false)
                    return
                  }
                  default:
                    break
                }
                const sensorTimeLength = deviceConf.sensorTimeLength || platformConsts.defaultValues.sensorTimeLength
                const sensorTimeDifference = deviceConf.sensorTimeDifference || platformConsts.defaultValues.sensorTimeDifference
                subAccessory.context.cacheLastAct = params[chan]
                const timeOfMotion = new Date(params[chan])
                const diff = (timeNow.getTime() - timeOfMotion.getTime()) / 1000
                let serv
                let char
                if (diff < sensorTimeDifference) {
                  switch (deviceConf.type) {
                    case 'water':
                      serv = this.hapServ.LeakSensor
                      char = this.hapChar.LeakDetected
                      break
                    case 'fire':
                    case 'smoke':
                      serv = this.hapServ.SmokeSensor
                      char = this.hapChar.SmokeDetected
                      break
                    case 'co':
                      serv = this.hapServ.CarbonMonoxideSensor
                      char = this.hapChar.CarbonMonoxideDetected
                      break
                    case 'co2':
                      serv = this.hapServ.CarbonDioxideSensor
                      char = this.hapChar.CarbonDioxideDetected
                      break
                    case 'contact': {
                      serv = this.hapServ.ContactSensor
                      char = this.hapChar.ContactSensorState
                      const initialTime = subAccessory.eveService.getInitialTime()
                      subAccessory
                        .getService(serv)
                        .updateCharacteristic(
                          this.eveChar.LastActivation,
                          Math.round(new Date().valueOf() / 1000) - initialTime,
                        )
                      break
                    }
                    case 'occupancy':
                      serv = this.hapServ.OccupancySensor
                      char = this.hapChar.OccupancyDetected
                      break
                    case 'p_button':
                      serv = this.hapServ.StatelessProgrammableSwitch
                      char = this.hapChar.ProgrammableSwitchEvent
                      break
                    case 'doorbell':
                      serv = this.hapServ.Doorbell
                      char = this.hapChar.ProgrammableSwitchEvent
                      break
                    default: {
                      serv = this.hapServ.MotionSensor
                      char = this.hapChar.MotionDetected
                      const initialTime = subAccessory.eveService.getInitialTime()
                      subAccessory
                        .getService(serv)
                        .updateCharacteristic(
                          this.eveChar.LastActivation,
                          Math.round(new Date().valueOf() / 1000) - initialTime,
                        )
                      break
                    }
                  }

                  // Call any webhook defined in the config
                  if (deviceConf.sensorWebHook) {
                    try {
                      const _whUrl = new URL(deviceConf.sensorWebHook)
                      if (!['http:', 'https:'].includes(_whUrl.protocol) || /^(localhost$|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0)/.test(_whUrl.hostname)) {
                        throw new Error('webhook URL blocked: private/internal addresses not permitted')
                      }
                      await axios.get(deviceConf.sensorWebHook, {
                        timeout: 5000,
                      })
                      if (enableLogging) {
                        this.log(
                          '[%s] %s [GET %s].',
                          subAccessory.displayName,
                          'http webhook request successful',
                          deviceConf.sensorWebHook,
                        )
                      }
                    } catch (e) {
                      if (enableLogging) {
                        this.log(
                          '[%s] %s %s.',
                          subAccessory.displayName,
                          'http webhook request failed as',
                          e.message,
                        )
                      }
                    }
                  }

                  // Programmable button and doorbell activate differently
                  if (char === this.hapChar.ProgrammableSwitchEvent) {
                    subAccessory.getService(serv).updateCharacteristic(char, 0)
                    if (params.updateSource && enableLogging) {
                      this.log(
                        '[%s] %s [%s].',
                        subAccessory.displayName,
                        this.lang.curState,
                        this.lang.buttonSingle,
                      )
                    }
                    return
                  }
                  subAccessory.getService(serv).updateCharacteristic(char, 1)
                  subAccessory.eveService.addEntry({ status: 1 })
                  if (params.updateSource && enableLogging) {
                    this.log(
                      '[%s] %s [%s].',
                      subAccessory.displayName,
                      this.lang.curState,
                      this.lang.rfTrigYes,
                    )
                  }

                  const updateKey = Math.random()
                    .toString(36)
                    .substring(2, 10)
                  subAccessory.context.updateKey = updateKey
                  await sleep(sensorTimeLength * 1000)
                  if (updateKey !== subAccessory.context.updateKey) {
                    return
                  }
                  subAccessory.getService(serv).updateCharacteristic(char, 0)
                  subAccessory.eveService.addEntry({ status: 0 })
                  if (params.updateSource && enableLogging) {
                    this.log(
                      '[%s] %s [%s].',
                      subAccessory.displayName,
                      this.lang.curState,
                      this.lang.rfTrigNo,
                    )
                  }
                }
              } else {
                throw new Error(`${this.lang.rfNotFound}[${chan}]`)
              }
            } catch (err) {
              this.log.warn('[%s] %s %s.', this.name, this.lang.devNotRf, parseError(err))
            }
          })
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
