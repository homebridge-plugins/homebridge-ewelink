import platformConsts from '../../utils/constants.js'
import { generateRandomString, hasProperty, sleep } from '../../utils/functions.js'

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
        this.enableDebugLogging = false
        break
    }

    // Set up the accessory with default positions when added the first time
    if (!hasProperty(this.accessory.context, 'cacheCurrentPosition')) {
      this.accessory.context.cacheCurrentPosition = 0
      this.accessory.context.cachePositionState = 2
      this.accessory.context.cacheTargetPosition = 0
    }

    // Add the door service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Door)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.Door)
      this.service.updateCharacteristic(this.hapChar.CurrentPosition, 0)
      this.service.updateCharacteristic(this.hapChar.TargetPosition, 0)
      this.service.updateCharacteristic(this.hapChar.PositionState, 2)
    }

    // Certain devices give power readings
    if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
      // Add Eve power characteristics
      this.powerReadings = true
      if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
        this.service.addCharacteristic(this.eveChar.CurrentConsumption)
      }
      if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
        this.service.addCharacteristic(this.eveChar.ElectricCurrent)
      }
      if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
        this.service.addCharacteristic(this.eveChar.Voltage)
      }
    }

    // Add the set handler to the target position characteristic
    this.service.getCharacteristic(this.hapChar.TargetPosition).onSet((value) => {
      // We don't use await as we want the callback to be run straight away
      this.internalPositionUpdate(value)
    })

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.CurrentPosition).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.CurrentPosition).value
      })
      this.service.getCharacteristic(this.hapChar.TargetPosition).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.TargetPosition).value
      })
    }

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
      showAs: 'door',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalPositionUpdate(value) {
    try {
      let prevPosition = this.accessory.context.cacheCurrentPosition
      if (value === prevPosition) {
        return
      }
      const params = {
        switches: [],
      }
      const prevState = this.accessory.context.cachePositionState
      const percentStepUpPerDS = this.operationTimeUp / 100
      const percentStepDownPerDS = this.operationTimeDown / 100
      const updateKey = generateRandomString(5)
      this.updateKey = updateKey
      if (prevState !== 2) {
        params.switches.push({ switch: 'off', outlet: 0 })
        params.switches.push({ switch: 'off', outlet: 1 })
        await this.platform.sendDeviceUpdate(this.accessory, params)
        params.switches = []
        const posPercentChange = Math.floor(Date.now() / 100) - this.accessory.context.cacheLastStartTime
        const posPercentChangeUp = Math.floor(percentStepUpPerDS * posPercentChange)
        const posPercentChangeDown = Math.floor(percentStepDownPerDS * posPercentChange)
        if (prevState === 0) {
          // Was going down
          prevPosition -= posPercentChangeDown
        } else {
          // Was going up
          prevPosition += posPercentChangeUp
        }
        prevPosition = Math.min(Math.max(prevPosition, 0), 100)
        this.service.updateCharacteristic(this.hapChar.CurrentPosition, prevPosition)
        this.accessory.context.cacheCurrentPosition = prevPosition
      }
      const diffPosition = value - prevPosition
      const setToMoveUp = diffPosition > 0
      let decisecondsToMove
      if (setToMoveUp) {
        decisecondsToMove = Math.round(Math.abs(diffPosition) * percentStepUpPerDS)
        params.switches.push({ switch: 'on', outlet: 0 })
      } else {
        decisecondsToMove = Math.round(Math.abs(diffPosition) * percentStepDownPerDS)
        params.switches.push({ switch: 'on', outlet: 1 })
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      params.switches = []
      this.accessory.context.cacheTargetPosition = value
      this.accessory.context.cachePositionState = setToMoveUp ? 1 : 0
      this.accessory.context.cacheLastStartTime = Math.floor(Date.now() / 100)
      await sleep(decisecondsToMove * 100)
      if (this.updateKey !== updateKey) {
        return
      }
      params.switches.push({
        switch: 'off',
        outlet: setToMoveUp ? 0 : 1,
      })
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.service.updateCharacteristic(this.hapChar.PositionState, 2)
      this.service.updateCharacteristic(this.hapChar.CurrentPosition, value)
      this.accessory.context.cachePositionState = 2
      this.accessory.context.cacheCurrentPosition = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%]', this.name, this.lang.curPos, value)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetPosition,
          this.accessory.context.cacheTargetPosition,
        )
      }, 2000)
      this.service.updateCharacteristic(this.hapChar.TargetPosition, new this.hapErr(-70402))
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
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (!this.powerReadings) {
        return
      }
      let logger = false
      let power
      let voltage
      let current
      if (hasProperty(params, 'actPow_00')) {
        power = Number.parseInt(params.actPow_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        logger = true
      }
      if (hasProperty(params, 'voltage_00')) {
        voltage = Number.parseInt(params.voltage_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.Voltage, voltage)
        logger = true
      }
      if (hasProperty(params, 'current_00')) {
        current = Number.parseInt(params.current_00, 10) / 100
        this.service.updateCharacteristic(this.eveChar.ElectricCurrent, current)
        logger = true
      }
      if (params.updateSource && logger && this.enableLogging) {
        this.log(
          '[%s] %s%s%s.',
          this.name,
          power !== undefined ? `${this.lang.curPower} [${power}W]` : '',
          voltage !== undefined ? ` ${this.lang.curVolt} [${voltage}V]` : '',
          current !== undefined ? ` ${this.lang.curCurr} [${current}A]` : '',
        )
      }
    } catch (err) {
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
