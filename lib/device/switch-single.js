import platformConsts from '../utils/constants.js'
import { hasProperty } from '../utils/functions.js'

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

    /*
    UIID 1/6/14/24/27/112/1009/1256/7004: single switch, no power readings
    UIID 5: single switch, with wattage readings
    UIID 32: single switch, with wattage, voltage and amp readings
    UIID 77/78/81/107/112/138/160: single switch but firmware uses multiple channels (only need CH0)
    UIID 182/190: single switch but multiple channels with wattage, voltage and amp readings
    */

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.offlineAsOff = deviceConf.offlineAsOff
    this.inUsePowerThreshold = deviceConf.inUsePowerThreshold || platformConsts.defaultValues.inUsePowerThreshold

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

    // If the accessory has a outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Some models provide a power reading in different decimals
    this.divisor = 1

    switch (this.accessory.context.eweUIID) {
      case 5:
        // Add Eve power characteristics
        this.powerReadings = true
        if (!this.service.testCharacteristic(this.hapChar.OutletInUse)) {
          this.service.addCharacteristic(this.hapChar.OutletInUse)
        }
        if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
          this.service.addCharacteristic(this.eveChar.CurrentConsumption)
        }

        // Remove unused Eve characteristics
        if (this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
          this.service.removeCharacteristic(
            this.service.getCharacteristic(this.eveChar.ElectricCurrent),
          )
        }
        if (this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.Voltage))
        }
        break
      case 32:
      case 182:
      case 190:
      case 226:
      case 276:
      case 7032:
        // Add Eve power characteristics
        this.powerReadings = true
        if (!this.service.testCharacteristic(this.hapChar.OutletInUse)) {
          this.service.addCharacteristic(this.hapChar.OutletInUse)
        }
        if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
          this.service.addCharacteristic(this.eveChar.CurrentConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
          this.service.addCharacteristic(this.eveChar.ElectricCurrent)
        }
        if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.addCharacteristic(this.eveChar.Voltage)
        }

        if ([190, 276, 7032].includes(this.accessory.context.eweUIID)) {
          this.divisor = 100
        }
        break
      default:
        // Remove unused Eve characteristics
        if (this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
          this.service.removeCharacteristic(
            this.service.getCharacteristic(this.eveChar.CurrentConsumption),
          )
        }
        if (this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
          this.service.removeCharacteristic(
            this.service.getCharacteristic(this.eveChar.ElectricCurrent),
          )
        }
        if (this.service.testCharacteristic(this.eveChar.Voltage)) {
          this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.Voltage))
        }
        break
    }

    // Set a flag for devices with hardware that use multi-channel format
    if (
      platformConsts.devices.switchSCM.includes(this.accessory.context.eweUIID)
      || platformConsts.devices.switchSCMPower.includes(this.accessory.context.eweUIID)
    ) {
      this.isSCM = true
    }

    // The MINI R3/R4 family reports wall button presses, useful in detached relay mode
    if (this.accessory.context.eweUIID === 138) {
      this.buttonService = this.accessory.getService(this.hapServ.StatelessProgrammableSwitch)
        || this.accessory.addService(this.hapServ.StatelessProgrammableSwitch)
    } else if (this.accessory.getService(this.hapServ.StatelessProgrammableSwitch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.StatelessProgrammableSwitch))
    }

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
    if (!platform.config.disableNoResponse) {
      this.service.getCharacteristic(this.hapChar.On).onGet(() => {
        if (!this.isOnline) {
          throw new this.hapErr(-70402)
        }
        return this.service.getCharacteristic(this.hapChar.On).value
      })
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, {
      log: () => {},
    })

    // Set up extra features for outlets that provide power readings
    if (this.powerReadings) {
      // Set up an interval to get eWeLink to send power updates
      this.initialTimeout = setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      inUsePowerThreshold: this.inUsePowerThreshold,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'default',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (newValue === this.cacheState) {
        return
      }
      const params = {}
      if (this.isSCM) {
        params.switches = [{ switch: newValue, outlet: 0 }]
        if (this.accessory.context.eweUIID === 190) {
          params.operSide = 1
        }
      } else if (this.accessory.context.eweUIID === 226) {
        params.switch = value
      } else {
        params.switch = newValue
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newValue
      this.accessory.eveService.addEntry({ status: value ? 1 : 0 })
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalUIUpdate() {
    try {
      // Skip polling if device isn't online
      if (!this.isOnline) {
        return
      }

      // Use sledonline trick for LAN-connected devices to force state report
      if (this.accessory.context.reachableLAN) {
        await this.platform.sendDeviceUpdate(this.accessory, { sledOnline: true })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, { uiActive: 120 })
      }
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (
        this.buttonService
        && hasProperty(params, 'key')
        && [0, 1, 2].includes(params.key)
        && params.trigTime
        && params.trigTime !== this.lastTrigTime
      ) {
        this.lastTrigTime = params.trigTime
        this.buttonService.updateCharacteristic(this.hapChar.ProgrammableSwitchEvent, params.key)
        if (params.updateSource && this.enableLogging) {
          const doubleLong = params.key === 1 ? this.lang.buttonDouble : this.lang.buttonLong
          const textLabel = params.key === 0 ? this.lang.buttonSingle : doubleLong
          this.log('[%s] %s [%s].', this.name, this.lang.buttonEvent, textLabel)
        }
      }
      if (!this.isSCM && hasProperty(params, 'switch')) {
        // Normalize boolean switch values (UIID 226 uses true/false)
        const newState = typeof params.switch === 'boolean'
          ? (params.switch ? 'on' : 'off')
          : params.switch
        if (newState !== this.cacheState) {
          this.cacheState = newState
          this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
          this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
          }
        }
      }
      if (this.isSCM && params.switches && params.switches[0].switch !== this.cacheState) {
        this.cacheState = params.switches[0].switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (!this.powerReadings) {
        return
      }

      // Some models (e.g. uiid 226) report their readings under phase names
      if (hasProperty(params, 'phase_0_p')) {
        params.power = params.phase_0_p
      }
      if (hasProperty(params, 'phase_0_v')) {
        params.voltage = params.phase_0_v
      }
      if (hasProperty(params, 'phase_0_c')) {
        params.current = params.phase_0_c
      }
      let logger = false
      let power
      let voltage
      let current
      if (hasProperty(params, 'power')) {
        power = Math.round((Number.parseFloat(params.power) * 100) / this.divisor) / 100
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        this.service.updateCharacteristic(
          this.hapChar.OutletInUse,
          this.cacheState === 'on' && Number.parseFloat(params.power) > this.inUsePowerThreshold,
        )
        logger = true
      }
      if (hasProperty(params, 'voltage')) {
        voltage = Math.round((Number.parseFloat(params.voltage) * 100) / this.divisor) / 100
        this.service.updateCharacteristic(this.eveChar.Voltage, voltage)
        logger = true
      }
      if (hasProperty(params, 'current')) {
        current = Math.round((Number.parseFloat(params.current) * 100) / this.divisor) / 100
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
    clearTimeout(this.initialTimeout)
    clearInterval(this.intervalPoll)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
    if (this.offlineAsOff && !isOnline && this.cacheState !== 'off') {
      this.service.updateCharacteristic(this.hapChar.On, false)
      this.cacheState = 'off'
      if (this.enableLogging) {
        this.log('[%s] %s [%s - offline]', this.name, this.lang.curState, this.cacheState)
      }
    }
  }

  async currentState() {
    const toReturn = {}
    toReturn.services = ['switch']
    toReturn.switch = {
      state: this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
    }
    if (this.powerReadings) {
      try {
        toReturn.services.push('power')
        toReturn.power = {
          state: await this.platform.sendDeviceUpdate(this.accessory, { hundredDaysKwh: 'get' }),
          voltage: this.service.testCharacteristic(this.eveChar.Voltage)
            ? this.service.getCharacteristic(this.eveChar.Voltage).value
            : undefined,
          power: this.service.testCharacteristic(this.eveChar.CurrentConsumption)
            ? this.service.getCharacteristic(this.eveChar.CurrentConsumption).value
            : undefined,
          current: this.service.testCharacteristic(this.eveChar.ElectricCurrent)
            ? this.service.getCharacteristic(this.eveChar.ElectricCurrent).value
            : undefined,
        }
      } catch (err) {
        // Suppress errors here
      }
    }
    return toReturn
  }
}
