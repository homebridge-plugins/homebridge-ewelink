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

    // Initially set the online flag as true (to be then updated as false if necessary)
    this.isOnline = true

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.operationTimeUp = deviceConf.operationTime || platformConsts.defaultValues.operationTime
    this.operationTimeDown = deviceConf.operationTimeDown || this.operationTimeUp

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

    // Set up the accessory with default positions when added the first time
    if (!hasProperty(this.accessory.context, 'cacheStates')) {
      this.accessory.context.cacheStates = [
        { cacheCurrentDoorState: 1, cacheTargetDoorState: 1 },
        { cacheCurrentDoorState: 1, cacheTargetDoorState: 1 },
        { cacheCurrentDoorState: 1, cacheTargetDoorState: 1 },
        { cacheCurrentDoorState: 1, cacheTargetDoorState: 1 },
      ]
    }

    // We want four garage door services for this accessory
    ['A', 'B', 'C', 'D'].forEach((v) => {
      // Add the garage door service if it doesn't already exist
      let gdService = this.accessory.getService(`Garage ${v}`)
      if (!gdService) {
        gdService = this.accessory.addService(this.hapServ.GarageDoorOpener, `Garage ${v}`, `garage${v}`)
        gdService.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
        gdService.updateCharacteristic(this.hapChar.TargetDoorState, 1)
        gdService.updateCharacteristic(this.hapChar.ObstructionDetected, false)
      }

      // Add the set handler to the target position characteristic
      gdService.getCharacteristic(this.hapChar.TargetDoorState).onSet((value) => {
        // We don't use await as we want the callback to be run straight away
        this.internalStateUpdate(v, value)
      })

      // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
      if (!platform.config.disableNoResponse) {
        gdService.getCharacteristic(this.hapChar.CurrentDoorState).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return gdService.getCharacteristic(this.hapChar.CurrentDoorState).value
        })
        gdService.getCharacteristic(this.hapChar.TargetDoorState).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return gdService.getCharacteristic(this.hapChar.TargetDoorState).value
        })
      }
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      operationTimeDown: this.operationTimeDown,
      operationTimeUp: this.operationTimeUp,
      showAs: 'garage_four',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(garage, value) {
    try {
      let garageChannel
      switch (garage) {
        case 'A':
          garageChannel = 0
          break
        case 'B':
          garageChannel = 1
          break
        case 'C':
          garageChannel = 2
          break
        case 'D':
          garageChannel = 3
          break
        default:
          return
      }
      const prevState = this.accessory.context.cacheStates[garageChannel].cacheCurrentDoorState
      if (value === prevState % 2) {
        return
      }
      const gdService = this.accessory.getService(`Garage ${garage}`)
      this.inUse = true
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      gdService.updateCharacteristic(this.hapChar.TargetDoorState, value)
      gdService.updateCharacteristic(this.hapChar.CurrentDoorState, value + 2)
      this.accessory.context.cacheStates[garageChannel].cacheTargetDoorState = value
      this.accessory.context.cacheStates[garageChannel].cacheCurrentDoorState = value + 2
      const params = {
        switches: [
          {
            switch: 'on',
            outlet: garageChannel,
          },
        ],
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      await sleep(2000)
      this.inUse = false
      const operationTime = value === 0 ? this.operationTimeUp : this.operationTimeDown
      await sleep(Math.max((operationTime - 20) * 100, 0))
      if (this.updateKey !== updateKey) {
        return
      }
      gdService.updateCharacteristic(this.hapChar.CurrentDoorState, value)
      this.accessory.context.cacheStates[garageChannel].cacheCurrentDoorState = value
      if (this.enableLogging) {
        this.log(
          '[%s] %s [garage %s %s].',
          this.name,
          this.lang.curState,
          garageChannel,
          value === 0 ? this.lang.doorOpen : this.lang.doorClosed,
        )
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, true)
      const gdService = this.accessory.getService(`Garage ${garage}`)
      setTimeout(() => {
        gdService.updateCharacteristic(
          this.hapChar.TargetDoorState,
          this.accessory.context.cacheTargetDoorState,
        )
      }, 2000)
      gdService.updateCharacteristic(this.hapChar.TargetDoorState, new this.hapErr(-70402))
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
