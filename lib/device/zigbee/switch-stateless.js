import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.hideLongDouble = deviceConf.hideLongDouble
    this.lowBattThreshold = deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold
    this.sensorTimeDifference = deviceConf.sensorTimeDifference || platformConsts.defaultValues.sensorTimeDifference

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

    // Add the stateless switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.StatelessProgrammableSwitch)
      || this.accessory.addService(this.hapServ.StatelessProgrammableSwitch)

    // Hide the double and long press options if the user wants
    if (this.hideLongDouble) {
      this.service.getCharacteristic(this.hapChar.ProgrammableSwitchEvent).setProps({
        validValues: [0],
      })
    }

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      hideLongDouble: this.hideLongDouble,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      lowBattThreshold: this.lowBattThreshold,
      sensorTimeDifference: this.sensorTimeDifference,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    try {
      if (hasProperty(params, 'battery') && params.battery !== this.cacheBatt) {
        this.cacheBatt = params.battery
        this.cacheBattScaled = Math.max(Math.min(this.cacheBatt, 100), 0)
        this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBattScaled)
        this.battService.updateCharacteristic(
          this.hapChar.StatusLowBattery,
          this.cacheBattScaled < this.lowBattThreshold ? 1 : 0,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s%].', this.name, this.lang.curBatt, this.cacheBattScaled)
        }
      }
      if (
        hasProperty(params, 'key')
        && [0, 1, 2].includes(params.key)
        && params.trigTime
      ) {
        const timeDiff = (Date.now() - params.trigTime) / 1000
        if (timeDiff < this.sensorTimeDifference) {
          this.service.updateCharacteristic(this.hapChar.ProgrammableSwitchEvent, params.key)
          if (params.updateSource && this.enableLogging) {
            const doubleLong = params.key === 1 ? this.lang.buttonDouble : this.lang.buttonLong
            const textLabel = params.key === 0 ? this.lang.buttonSingle : doubleLong
            this.log('[%s] %s [%s].', this.name, this.lang.curState, textLabel)
          }
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
