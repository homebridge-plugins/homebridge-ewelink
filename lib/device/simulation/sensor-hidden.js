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
    this.accessory = accessory
    this.subAccessory = subAccessory

    // Set up custom variables for this device type
    const group = platform.deviceConf[subAccessory.context.eweDeviceId] || {}
    this.isGarage = group.showAs === 'garage'
    this.operationTime = group.operationTime || platformConsts.defaultValues.operationTime

    // Set the correct logging variables for this accessory
    switch (group.overrideLogging) {
      case 'standard':
      case 'debug':
        this.enableLogging = true
        break
      case 'disable':
        this.enableLogging = false
        break
      default:
        this.enableLogging = !platform.config.disableDeviceLogging
        break
    }
  }

  async externalUpdate(params) {
    try {
      if (!hasProperty(params, 'lock') && !params.switch) {
        return
      }
      let newState
      if (params.switch) {
        newState = params.switch === 'on'
          ? 1
          : 0
      } else {
        newState = params.lock
      }
      if (newState === this.cacheState) {
        return
      }
      this.cacheState = newState
      const subService = this.subAccessory.getService(
        this.isGarage ? this.hapServ.GarageDoorOpener : this.hapServ.LockMechanism,
      )
      const name = this.subAccessory.displayName
      switch (newState) {
        case 0:
          if (this.isGarage) {
            subService.updateCharacteristic(this.hapChar.TargetDoorState, 1)
            subService.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
            this.subAccessory.eveService.addEntry({ status: 1 })
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', name, this.lang.curState, this.lang.doorClosed)
            }
          } else {
            subService.updateCharacteristic(this.hapChar.LockTargetState, 1)
            subService.updateCharacteristic(this.hapChar.LockCurrentState, 1)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', name, this.lang.curState, this.lang.lockLocked)
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
            const newTO = subService.getCharacteristic(this.eveChar.TimesOpened).value + 1
            subService.updateCharacteristic(this.eveChar.TimesOpened, newTO)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', name, this.lang.curState, this.lang.doorOpen)
            }
          } else {
            subService.updateCharacteristic(this.hapChar.LockTargetState, 0)
            subService.updateCharacteristic(this.hapChar.LockCurrentState, 0)
            if (params.updateSource && this.enableLogging) {
              this.log('[%s] %s [%s].', name, this.lang.curState, this.lang.lockUnlocked)
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
