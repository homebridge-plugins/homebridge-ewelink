import platformConsts from '../../utils/constants.js'
import { generateRandomString, sleep } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
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
    this.operationTime = deviceConf.operationTime || platformConsts.defaultValues.operationTime

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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a contact sensor service then remove it
    if (this.accessory.getService(this.hapServ.ContactSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.ContactSensor))
    }

    // If the accessory has a lock service then remove it
    if (this.accessory.getService(this.hapServ.LockMechanism)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.LockMechanism))
    }

    // Add the garage door service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.GarageDoorOpener)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.GarageDoorOpener)
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, 1)
      this.service.updateCharacteristic(this.hapChar.ObstructionDetected, false)
      this.service.addCharacteristic(this.eveChar.LastActivation)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Remove unneeded characteristics
    if (this.service.testCharacteristic(this.hapChar.ContactSensorState)) {
      this.service.removeCharacteristic(
        this.service.getCharacteristic(this.hapChar.ContactSensorState),
      )
    }
    if (this.service.testCharacteristic(this.hapChar.OpenDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.OpenDuration))
    }
    if (this.service.testCharacteristic(this.hapChar.ClosedDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.ClosedDuration))
    }

    // Add the set handler to the garage door reset total characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(() => {
      this.service.updateCharacteristic(this.eveChar.TimesOpened, 0)
    })

    // Add the set handler to the target position characteristic
    this.service.getCharacteristic(this.hapChar.TargetDoorState).onSet((value) => {
      // We don't use await as we want the callback to be run straight away
      this.internalStateUpdate(value)
    })

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.CurrentDoorState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      })
      this.service.getCharacteristic(this.hapChar.TargetDoorState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      })
    }

    // Update the obstruction detected to false on Homebridge restart
    this.service.updateCharacteristic(this.hapChar.ObstructionDetected, false)

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('door', this.accessory, {
      log: () => {},
    })
    this.accessory.eveService.addEntry({
      status: this.service.getCharacteristic(this.hapChar.CurrentDoorState).value === 0 ? 0 : 1,
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      operationTime: this.operationTime,
      showAs: 'garage_eachen',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const params = { switch: value === 0 ? 'on' : 'off' }
      const curState = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (value === curState % 2) {
        return
      }
      this.inUse = true
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, value)
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, value + 2)
      await sleep(3000)
      this.inUse = false
      if (value === 0) {
        this.accessory.eveService.addEntry({ status: 0 })
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
        )
        await sleep(Math.max((this.operationTime - 30) * 100, 0))
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 0)
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.doorOpen)
        }
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetDoorState,
          this.accessory.context.cacheTargetDoorState,
        )
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, new this.hapErr(-70402))
    }
  }

  async externalUpdate(params) {
    try {
      if (!params.switch || this.inUse) {
        return
      }

      // In a period of three seconds we want to only use the 'last' update
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      await sleep(3000)
      if (this.updateKey !== updateKey) {
        return
      }

      // Update the characteristics
      const newValue = params.switch === 'on' ? 0 : 1
      if (this.service.getCharacteristic(this.hapChar.TargetDoorState).value !== newValue) {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, newValue)
      }
      if (this.service.getCharacteristic(this.hapChar.CurrentDoorState).value !== newValue) {
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, newValue)
      }
      this.accessory.eveService.addEntry({ status: newValue })
      if (newValue === 0) {
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1,
        )
      }
      if (params.updateSource && this.enableLogging) {
        this.log(
          '[%s] %s [%s].',
          this.name,
          this.lang.curState,
          params.switch === 'on' ? this.lang.doorOpen : this.lang.doorClosed,
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  currentState() {
    return {
      services: ['garage'],
      garage: {
        target: this.service.getCharacteristic(this.hapChar.TargetDoorState).value,
        state: this.service.getCharacteristic(this.hapChar.CurrentDoorState).value,
      },
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
