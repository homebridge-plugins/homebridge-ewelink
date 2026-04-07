import platformConsts from '../../utils/constants.js'
import { hasProperty, sleep } from '../../utils/functions.js'

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
        this.enableDebugLogging = platform.config.debug
        break
    }

    // Set up the accessory with default positions when added the first time
    if (!hasProperty(this.accessory.context, 'cacheCurrentDoorState')) {
      this.accessory.context.cacheOneCurrentDoorState = 1
      this.accessory.context.cacheOneTargetDoorState = 1
      this.accessory.context.cacheTwoCurrentDoorState = 1
      this.accessory.context.cacheTwoTargetDoorState = 1
    }

    // Certain devices give power readings
    if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
      this.powerReadings = true
    }

    // We want two garage door services for this accessory
    ['1', '2'].forEach((v) => {
      // Add the garage door service if it doesn't already exist
      let gdService = this.accessory.getService(`Garage ${v}`)
      if (!gdService) {
        gdService = this.accessory.addService(this.hapServ.GarageDoorOpener, `Garage ${v}`, `garage${v}`)
        gdService.updateCharacteristic(this.hapChar.CurrentDoorState, 1)
        gdService.updateCharacteristic(this.hapChar.TargetDoorState, 1)
        gdService.updateCharacteristic(this.hapChar.ObstructionDetected, false)
      }

      // Add Eve power characteristics
      if (this.powerReadings) {
        if (!gdService.testCharacteristic(this.eveChar.CurrentConsumption)) {
          gdService.addCharacteristic(this.eveChar.CurrentConsumption)
        }
        if (!gdService.testCharacteristic(this.eveChar.ElectricCurrent)) {
          gdService.addCharacteristic(this.eveChar.ElectricCurrent)
        }
        if (!gdService.testCharacteristic(this.eveChar.Voltage)) {
          gdService.addCharacteristic(this.eveChar.Voltage)
        }
      }

      // Add the set handler to the target position characteristic
      gdService.getCharacteristic(this.hapChar.TargetDoorState).onSet((value) => {
        // We don't use await as we want the callback to be run straight away
        this.internalUpdate(`Garage ${v}`, value)
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

    // Set up an interval to get eWeLink to send power updates
    if (this.powerReadings && platform.config.mode !== 'lan') {
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      operationTimeDown: this.operationTimeDown,
      operationTimeUp: this.operationTimeUp,
      showAs: 'garage_two',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalUpdate(garage, value) {
    try {
      const newPos = value
      const params = {
        switches: [],
      }
      const gdService = this.accessory.getService(garage)
      const prevState = garage === 'Garage 1'
        ? this.accessory.context.cacheOneCurrentDoorState
        : this.accessory.context.cacheTwoCurrentDoorState
      if (newPos === prevState % 2) {
        return
      }
      this.inUse = true
      gdService.updateCharacteristic(this.hapChar.TargetDoorState, newPos)
      gdService.updateCharacteristic(this.hapChar.CurrentDoorState, newPos + 2)
      switch (garage) {
        case 'Garage 1': {
          this.accessory.context.cacheOneTargetDoorState = newPos
          this.accessory.context.cacheOneCurrentDoorState = newPos + 2
          params.switches.push({
            switch: newPos === 0 ? 'on' : 'off',
            outlet: 0,
          })
          params.switches.push({
            switch: newPos === 1 ? 'on' : 'off',
            outlet: 1,
          })
          break
        }
        case 'Garage 2': {
          this.accessory.context.cacheTwoTargetDoorState = newPos
          this.accessory.context.cacheTwoCurrentDoorState = newPos + 2
          params.switches.push({
            switch: newPos === 0 ? 'on' : 'off',
            outlet: 2,
          })
          params.switches.push({
            switch: newPos === 1 ? 'on' : 'off',
            outlet: 3,
          })
          break
        }
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      await sleep(2000)
      this.inUse = false
      const operationTime = newPos === 0 ? this.operationTimeUp : this.operationTimeDown
      await sleep(Math.max((operationTime - 20) * 100, 0))
      gdService.updateCharacteristic(this.hapChar.CurrentDoorState, newPos)
      switch (garage) {
        case 'Garage 1': {
          this.accessory.context.cacheOneCurrentDoorState = newPos
          if (this.enableLogging) {
            this.log(
              '[%s] [garage 1] %s [%s].',
              this.name,
              this.lang.curState,
              newPos === 0 ? this.lang.doorOpen : this.lang.doorClosed,
            )
          }
          break
        }
        case 'Garage 2': {
          this.accessory.context.cacheTwoCurrentDoorState = newPos
          if (this.enableLogging) {
            this.log(
              '[%s] [garage 2] %s [%s].',
              this.name,
              this.lang.curState,
              newPos === 0 ? this.lang.doorOpen : this.lang.doorClosed,
            )
          }
          break
        }
        default:
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, true)
      const gdService = this.accessory.getService(garage)
      setTimeout(() => {
        gdService.updateCharacteristic(
          this.hapChar.TargetDoorState,
          this.accessory.context.cacheTargetDoorState,
        )
      }, 2000)
      gdService.updateCharacteristic(this.hapChar.TargetDoorState, new this.hapErr(-70402))
    }
  }

  async internalUIUpdate() {
    try {
      // Skip polling if device isn't online
      if (!this.isOnline) {
        return
      }

      // Send the params to request the updates
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 0, time: 120 } })
      await sleep(2000)
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 1, time: 120 } })
    } catch (err) {
      // Suppress errors here
    }
  }

  externalUpdate(params) {
    try {
      if (params.switches && !this.inUse) {
        ['1', '2'].forEach(async (v) => {
          const gcService = this.accessory.getService(`Garage ${v}`)
          const prevState = v === '1'
            ? this.accessory.context.cacheOneCurrentDoorState
            : this.accessory.context.cacheTwoCurrentDoorState
          const newPos = [0, 2].includes(prevState) ? 3 : 2
          switch (v) {
            case '1':
              if (
                params.switches[0].switch === params.switches[1].switch
                || params.switches[prevState % 2].switch === 'on'
              ) {
                return
              }
              break
            case '2':
              if (
                params.switches[2].switch === params.switches[3].switch
                || params.switches[(prevState % 2) + 2].switch === 'on'
              ) {
                return
              }
              break
            default:
              return
          }
          this.inUse = true
          gcService.updateCharacteristic(this.hapChar.TargetDoorState, newPos - 2)
          gcService.updateCharacteristic(this.hapChar.CurrentDoorState, newPos)
          switch (v) {
            case '1':
              this.accessory.context.cacheOneCurrentDoorState = newPos
              this.accessory.context.cacheTwoTargetDoorState = newPos - 2
              break
            case '2':
              this.accessory.context.cacheTwoCurrentDoorState = newPos
              this.accessory.context.cacheTwoTargetDoorState = newPos - 2
              break
            default:
              return
          }
          await sleep(2000)
          this.inUse = false
          const operationTime = newPos === 2 ? this.operationTimeUp : this.operationTimeDown
          await sleep(Math.max((operationTime - 20) * 100, 0))
          gcService.updateCharacteristic(this.hapChar.CurrentDoorState, newPos - 2)
          switch (v) {
            case '1':
              this.accessory.context.cacheOneCurrentDoorState = newPos - 2
              if (params.updateSource && this.enableLogging) {
                this.log(
                  '[%s] [garage 1] %s [%s].',
                  this.name,
                  this.lang.curState,
                  newPos === 2 ? this.lang.doorOpen : this.lang.doorClosed,
                )
              }
              break
            case '2':
              this.accessory.context.cacheTwoCurrentDoorState = newPos - 2
              if (params.updateSource && this.enableLogging) {
                this.log(
                  '[%s] [garage 2] %s [%s].',
                  this.name,
                  this.lang.curState,
                  newPos === 2 ? this.lang.doorOpen : this.lang.doorClosed,
                )
              }
              break
            default:
          }
        })
      }

      // Get the power readings given by certain devices
      if (!this.powerReadings) {
        return
      }
      let logger0 = false
      let logger1 = false
      let power0
      let power1
      let voltage0
      let voltage1
      let current0
      let current1
      if (hasProperty(params, 'actPow_00')) {
        power0 = Number.parseInt(params.actPow_00, 10) / 100
        this.accessory
          .getService('Garage 1')
          .updateCharacteristic(this.eveChar.CurrentConsumption, power0)
        logger0 = true
      }
      if (hasProperty(params, 'actPow_01')) {
        power1 = Number.parseInt(params.actPow_01, 10) / 100
        this.accessory
          .getService('Garage 2')
          .updateCharacteristic(this.eveChar.CurrentConsumption, power1)
        logger1 = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage0 = Number.parseInt(params.voltage_00, 10) / 100
        this.accessory.getService('Garage 1').updateCharacteristic(this.eveChar.Voltage, voltage0)
        logger0 = true
      }
      if (hasProperty(params, 'voltage_01')) {
        voltage1 = Number.parseInt(params.voltage_01, 10) / 100
        this.accessory.getService('Garage 2').updateCharacteristic(this.eveChar.Voltage, voltage1)
        logger1 = true
      }
      if (hasProperty(params, 'current_00')) {
        current0 = Number.parseInt(params.current_00, 10) / 100
        this.accessory
          .getService('Garage 1')
          .updateCharacteristic(this.eveChar.ElectricCurrent, current0)
        logger0 = true
      }
      if (hasProperty(params, 'current_01')) {
        current1 = Number.parseInt(params.current_01, 10) / 100
        this.accessory
          .getService('Garage 2')
          .updateCharacteristic(this.eveChar.ElectricCurrent, current1)
        logger1 = true
      }
      if (params.updateSource && this.enableLogging) {
        if (logger0) {
          this.log(
            '[%s] [garage 1] %s%s%s.',
            this.name,
            power0 !== undefined ? `${this.lang.curPower} [${power0}W]` : '',
            voltage0 !== undefined ? ` ${this.lang.curVolt} [${voltage0}V]` : '',
            current0 !== undefined ? ` ${this.lang.curCurr} [${current0}A]` : '',
          )
        }
        if (logger1) {
          this.log(
            '[%s] [garage 2] %s%s%s.',
            this.name,
            power1 !== undefined ? `${this.lang.curPower} [${power1}W]` : '',
            voltage1 !== undefined ? ` ${this.lang.curVolt} [${voltage1}V]` : '',
            current1 !== undefined ? ` ${this.lang.curCurr} [${current1}A]` : '',
          )
        }
      }
    } catch (err) {
      this.inUse = false
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  destroy() {
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
