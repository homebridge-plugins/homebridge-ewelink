import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
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

    // Add the motion sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.MotionSensor)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.MotionSensor)
      this.service.addCharacteristic(this.eveChar.LastActivation)
    }

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('motion', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
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
        hasProperty(params, 'motion')
        && hasProperty(params, 'trigTime')
        && params.motion !== this.cacheState
      ) {
        this.cacheState = params.motion
        const timeDiff = (Date.now() - params.trigTime) / 1000
        const motionDetected = !!(
          params.updateSource
          && params.motion === 1
          && timeDiff < this.sensorTimeDifference
        )
        this.service.updateCharacteristic(this.hapChar.MotionDetected, motionDetected)
        if (motionDetected) {
          const initialTime = this.accessory.eveService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime,
          )
        }
        this.accessory.eveService.addEntry({ status: motionDetected ? 1 : 0 })
        if (params.updateSource && this.enableLogging) {
          this.log(
            '[%s] %s [%s].',
            this.name,
            this.lang.curState,
            motionDetected ? this.lang.motionYes : this.lang.motionNo,
          )
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
    // Reset stuck motion state when bridge goes offline
    if (!isOnline && this.cacheState === 1) {
      this.cacheState = 0
      this.service.updateCharacteristic(this.hapChar.MotionDetected, false)
    }
  }
}
