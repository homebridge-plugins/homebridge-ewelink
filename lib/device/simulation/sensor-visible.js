import platformConsts from '../../utils/constants.js'
import { hasProperty, sleep } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory, subAccessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.nameSub = subAccessory.displayName
    this.accessory = accessory
    this.subAccessory = subAccessory

    // Set up custom variables for this device type
    this.isDW2 = platformConsts.devices.sensorContact.includes(accessory.context.eweUIID)
    this.hasBattery = platformConsts.devices.garageSensors.includes(accessory.context.eweUIID)
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.scaleBattery = deviceConf.scaleBattery
    this.lowBattThreshold = deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold
    const group = platform.deviceConf[subAccessory.context.eweDeviceId] || {}
    this.isGarage = group.showAs === 'garage'
    this.operationTime = group.operationTime || platformConsts.defaultValues.operationTime

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

    // Set the correct logging variables for this sub accessory
    switch (group.overrideLogging) {
      case 'standard':
      case 'debug':
        this.enableLoggingSub = true
        break
      case 'disable':
        this.enableLoggingSub = false
        break
      default:
        this.enableLoggingSub = !platform.config.disableDeviceLogging
        break
    }

    // If the accessory has a leak sensor service then remove it
    if (this.accessory.getService(this.hapServ.LeakSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.LeakSensor))
    }

    // Add the contact sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.ContactSensor)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.ContactSensor)
      this.service.addCharacteristic(this.eveChar.LastActivation)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
      this.service.addCharacteristic(this.eveChar.OpenDuration)
      this.service.addCharacteristic(this.eveChar.ClosedDuration)
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Add the set handler to the contact sensor reset total characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(() => {
      this.service.updateCharacteristic(this.eveChar.TimesOpened, 0)
    })

    if (this.hasBattery) {
      // Add the battery service if it doesn't already exist
      this.batteryService = this.accessory.getService(this.hapServ.Battery)
        || this.accessory.addService(this.hapServ.Battery)
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('door', this.accessory, {
      log: () => {},
    })
    this.accessory.eveService.addEntry({
      status: this.service.getCharacteristic(this.hapChar.ContactSensorState).value,
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      lowBattThreshold: this.lowBattThreshold,
      scaleBattery: this.scaleBattery,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    try {
      if (
        this.batteryService
        && hasProperty(params, 'battery')
        && params.battery !== this.cacheBatt
      ) {
        this.cacheBatt = params.battery
        if (this.isDW2) {
          if (this.accessory.context.eweUIID === 154) {
            // No scaling needed for this model as provided as a %
            this.cacheBattScaled = this.cacheBatt
          } else {
            // Scaling needed for UIID 102 as provided as a voltage rather than a %
            this.cacheBattScaled = Math.min(Math.max(this.cacheBatt, 2), 3)
            this.cacheBattScaled = Math.round((this.cacheBattScaled - 2) * 100)
          }
        } else {
          this.cacheBattScaled = this.scaleBattery ? this.cacheBatt * 10 : this.cacheBatt
        }
        this.cacheBattScaled = Math.max(Math.min(this.cacheBattScaled, 100), 0)
        this.batteryService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBattScaled)
        this.batteryService.updateCharacteristic(
          this.hapChar.StatusLowBattery,
          this.cacheBattScaled < this.lowBattThreshold ? 1 : 0,
        )
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s%].', this.name, this.lang.curBatt, this.cacheBattScaled)
        }
      }
      if (!hasProperty(params, 'lock') && !params.switch) {
        return
      }
      let newState
      if (params.switch) {
        newState = params.switch === 'on' ? 1 : 0
      } else {
        newState = params.lock
      }
      if (newState === this.cacheState) {
        return
      }
      this.cacheState = newState
      if (newState === 1) {
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
        this.accessory.eveService.addEntry({ status: 1 })
        const initialTime = this.accessory.eveService.getInitialTime()
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - initialTime,
        )
        const newTO = this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
        this.service.updateCharacteristic(this.eveChar.TimesOpened, newTO)
      } else {
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
        this.accessory.eveService.addEntry({ status: 0 })
      }
      if (params.updateSource && this.enableLogging) {
        this.log(
          '[%s] %s [%s].',
          this.name,
          this.lang.curState,
          newState === 0 ? this.lang.contactYes : this.lang.contactNo,
        )
      }
      const subService = this.subAccessory.getService(
        this.isGarage ? this.hapServ.GarageDoorOpener : this.hapServ.LockMechanism,
      )
      switch (newState) {
        case 0:
          if (this.isGarage) {
            subService.updateCharacteristic(this.hapChar.TargetDoorState, 1)
            subService.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.subAccessory.eveService.addEntry({ status: 1 })
            if (params.updateSource && this.enableLoggingSub) {
              this.log('[%s] %s [%s].', this.nameSub, this.lang.curState, this.lang.doorClosed)
            }
          } else {
            subService.updateCharacteristic(this.hapChar.LockTargetState, 1)
            subService.updateCharacteristic(this.hapChar.LockCurrentState, 1)
            this.subAccessory.context.contactDetected = true
            if (params.updateSource && this.enableLoggingSub) {
              this.log('[%s] %s [%s].', this.nameSub, this.lang.curState, this.lang.lockLocked)
            }
          }
          break
        case 1: {
          if (this.isGarage) {
            await sleep(Math.max(this.operationTime * 100, 2000))
            subService.updateCharacteristic(this.hapChar.TargetDoorState, 0)
            subService.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
            this.subAccessory.eveService.addEntry({ status: 0 })
            const initialTime = this.subAccessory.eveService.getInitialTime()
            subService.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - initialTime,
            )
            subService.updateCharacteristic(
              this.eveChar.TimesOpened,
              subService.getCharacteristic(this.eveChar.TimesOpened).value + 1,
            )
            if (params.updateSource && this.enableLoggingSub) {
              this.log('[%s] %s [%s].', this.nameSub, this.lang.curState, this.lang.doorOpen)
            }
          } else {
            subService.updateCharacteristic(this.hapChar.LockTargetState, 0)
            subService.updateCharacteristic(this.hapChar.LockCurrentState, 0)
            this.subAccessory.context.contactDetected = false
            if (params.updateSource && this.enableLoggingSub) {
              this.log('[%s] %s [%s].', this.nameSub, this.lang.curState, this.lang.lockUnlocked)
            }
          }
          break
        }
        default:
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
