import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

// How long the HomeKit tile stays on after a trigger. The device runs its
// siren for whatever duration is configured in the eWeLink app and turns
// itself off without reporting that it has, so the tile resets itself rather
// than waiting for a state that never arrives.
const TILE_RESET_MS = 3000

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
    this.lowBattThreshold = deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold

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

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)
    this.service.updateCharacteristic(this.hapChar.On, false)

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)

    // Set up the handler for the switch
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      try {
        if (!value) {
          // The device stops on its own after its configured duration and
          // offers no early-stop command, so an off is only the tile resetting
          return
        }

        // The trigger rides on the device's own alarm settings, so send the
        // last reported settings back with the trigger flag added - a bare
        // flag could otherwise reset the volume and duration to defaults
        const setting = { ...(this.accessory.context.cacheAlarmSetting || {}), test: true }
        await this.platform.sendDeviceUpdate(this.accessory, { alarmSetting: setting })

        if (this.enableLogging) {
          this.log('[%s] %s [on].', this.name, this.lang.curState)
        }

        // Reset the tile shortly after - see TILE_RESET_MS
        clearTimeout(this.resetTimer)
        this.resetTimer = setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, false)
        }, TILE_RESET_MS)
      } catch (err) {
        this.platform.deviceUpdateError(this.accessory, err, false)
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, false)
        }, 2000)
        throw new this.hapErr(-70402)
      }
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      lowBattThreshold: this.lowBattThreshold,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    try {
      // Keep the device's own alarm settings so a trigger can send them back
      if (hasProperty(params, 'alarmSetting') && typeof params.alarmSetting === 'object') {
        this.accessory.context.cacheAlarmSetting = { ...params.alarmSetting }
        delete this.accessory.context.cacheAlarmSetting.test
      }
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
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  destroy() {
    clearTimeout(this.resetTimer)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
