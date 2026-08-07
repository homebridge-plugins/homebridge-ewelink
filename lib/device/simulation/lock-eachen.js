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

    // If the accessory has a garage  service then remove it
    if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
    }

    // Add the lock service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.LockMechanism)
      || this.accessory.addService(this.hapServ.LockMechanism)

    // Add the set handler to the lock target state characteristic
    this.service.getCharacteristic(this.hapChar.LockTargetState).onSet((value) => {
      // We don't use await as we want the callback to be run straight away
      this.internalUpdate(value)
    })

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.LockCurrentState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.LockCurrentState).value
      })
      this.service.getCharacteristic(this.hapChar.LockTargetState).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.LockTargetState).value
      })
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'garage_eachen',
      showAsEachen: 'lock',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalUpdate(value) {
    const currentState = this.service.getCharacteristic(this.hapChar.LockTargetState).value
    try {
      // Don't continue if the value is the same as before
      if (value === currentState) {
        return
      }

      // Generate the params
      const params = { switch: value === 0 ? 'on' : 'off' }
      this.inUse = true
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.service.updateCharacteristic(this.hapChar.LockTargetState, value)
      this.service.updateCharacteristic(this.hapChar.LockCurrentState, value)
      await sleep(3000)
      this.inUse = false
      if (this.enableLogging) {
        this.log(
          '[%s] %s [%s].',
          this.name,
          this.lang.curState,
          value === 0 ? this.lang.lockUnlocked : this.lang.lockLocked,
        )
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.LockTargetState, currentState)
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.LockTargetState, new this.hapErr(-70402))
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
      if (this.service.getCharacteristic(this.hapChar.LockTargetState).value !== newValue) {
        this.service.updateCharacteristic(this.hapChar.LockTargetState, newValue)
        this.service.updateCharacteristic(this.hapChar.LockCurrentState, newValue)
      }

      if (params.updateSource && this.enableLogging) {
        this.log(
          '[%s] %s [%s].',
          this.name,
          this.lang.curState,
          params.switch === 'on' ? this.lang.lockUnlocked : this.lang.lockLocked,
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
