import platformConsts from '../utils/constants.js'
import { hasProperty } from '../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
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
    UIID 182: single switch but multiple channels with wattage, voltage and amp readings
    */

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
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
        this.enableDebugLogging = false
        break
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Outlet)
      || this.accessory.addService(this.hapServ.Outlet)

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
        if (!this.service.testCharacteristic(this.eveChar.TotalConsumption)) {
          this.service.addCharacteristic(this.eveChar.TotalConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.ResetTotal)) {
          this.service.addCharacteristic(this.eveChar.ResetTotal)
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
      case 276:
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
        if (!this.service.testCharacteristic(this.eveChar.TotalConsumption)) {
          this.service.addCharacteristic(this.eveChar.TotalConsumption)
        }
        if (!this.service.testCharacteristic(this.eveChar.ResetTotal)) {
          this.service.addCharacteristic(this.eveChar.ResetTotal)
        }
        break
      default:
        // Remove unused Eve characteristics
        if (this.service.testCharacteristic(this.hapChar.OutletInUse)) {
          this.service.removeCharacteristic(
            this.service.getCharacteristic(this.eveChar.OutletInUse),
          )
        }
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
        if (this.service.testCharacteristic(this.eveChar.TotalConsumption)) {
          this.service.removeCharacteristic(
            this.service.getCharacteristic(this.eveChar.TotalConsumption),
          )
        }
        if (this.service.testCharacteristic(this.eveChar.ResetTotal)) {
          this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.ResetTotal))
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

    // Add the set handler to the outlet on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add a custom characteristic for inverting the switch
    if (!this.service.testCharacteristic(this.cusChar.InvertSwitch)) {
      this.service.addCharacteristic(this.cusChar.InvertSwitch)
    }
    this.service.updateCharacteristic(this.cusChar.InvertSwitch, this.cacheState === 'on')

    // Add the set handler to invert the switch
    this.service.getCharacteristic(this.cusChar.InvertSwitch).onSet((value) => {
      this.service.updateCharacteristic(this.hapChar.On, value)
      this.cacheState = value ? 'on' : 'off'
      this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
    })

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
    this.accessory.eveService = new platform.eveService('energy', this.accessory, {
      log: () => {},
    })

    // Set up extra features for outlets that provide power readings
    if (this.powerReadings) {
      // TotalConsumption is calculated by the plugin with these context readings
      if (!hasProperty(this.accessory.context, 'energyReadings')) {
        this.accessory.context.energyReadings = []
      }
      if (!hasProperty(this.accessory.context, 'energyReadingTotal')) {
        this.accessory.context.energyReadingTotal = 0
      }

      // Add the set handler to the outlet eve reset total energy characteristic
      this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(() => {
        this.accessory.context.energyReadings = []
        this.accessory.context.energyReadingTotal = 0
        this.service.updateCharacteristic(this.eveChar.TotalConsumption, 0)
      })

      // Set up an interval for the plugin to calculate an approx total consumption
      this.intervalPower = setInterval(() => {
        // Every 30 seconds start with a zero reading
        let total = 0

        // Check we have had readings within the previous 30 seconds
        if (this.accessory.context.energyReadings.length > 0) {
          // Accumulate the total from the energy readings
          this.accessory.context.energyReadings.forEach((x) => {
            total += x
          })

          // Divide this by the number of entries to get an average W5m
          total /= this.accessory.context.energyReadings.length

          // Convert this to Wh then kWh
          total /= 12
          total /= 1000

          // Accumulate the grand total that Eve reads as the total consumption
          this.accessory.context.energyReadingTotal += total
        }

        // Reset the array for each 30 second readings
        this.accessory.context.energyReadings = []

        // Update Eve with the new grand total
        this.service.updateCharacteristic(
          this.eveChar.TotalConsumption,
          this.accessory.context.energyReadingTotal,
        )
      }, 30000)

      // Set up an interval to get eWeLink to send power updates
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      inUsePowerThreshold: this.inUsePowerThreshold,
      isInched: true,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'outlet',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = this.cacheState === 'on' ? 'off' : 'on'
      const params = {}
      if (this.isSCM) {
        params.switches = [{ switch: 'on', outlet: 0 }]
        if (this.accessory.context.eweUIID === 190) {
          params.operSide = 1
        }
      } else {
        params.switch = 'on'
      }
      this.ignoreUpdates = true
      setTimeout(() => {
        this.ignoreUpdates = false
      }, 1500)
      await this.platform.sendDeviceUpdate(this.accessory, params)
      this.cacheState = newValue
      this.service.updateCharacteristic(this.cusChar.InvertSwitch, value)
      this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
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

      // Send the params to request the updates
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: 120 })
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      if (!this.isSCM && params.switch === 'on') {
        if (!this.ignoreUpdates) {
          this.ignoreUpdates = true
          setTimeout(() => {
            this.ignoreUpdates = false
          }, 1500)
          this.cacheState = this.cacheState === 'on' ? 'off' : 'on'
          this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
          this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
          }
        }
      }
      if (this.isSCM && params.switches && params.switches[0].switch === 'on') {
        if (!this.ignoreUpdates) {
          this.ignoreUpdates = true
          setTimeout(() => {
            this.ignoreUpdates = false
          }, 1500)
          this.cacheState = this.cacheState === 'on' ? 'off' : 'on'
          this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
          this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
          if (params.updateSource && this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
          }
        }
      }
      if (!this.powerReadings) {
        return
      }
      let logger = false
      if (hasProperty(params, 'power')) {
        const power = Number.parseFloat(params.power)
        this.service.updateCharacteristic(
          this.hapChar.OutletInUse,
          this.cacheState === 'on' && power > this.inUsePowerThreshold,
        )
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
        this.accessory.eveService.addEntry({ power })
        if (this.accessory.context.energyReadings.length < 100) {
          this.accessory.context.energyReadings.push(power)
        }
        logger = true
      }
      if (hasProperty(params, 'voltage')) {
        this.service.updateCharacteristic(this.eveChar.Voltage, Number.parseFloat(params.voltage))
        logger = true
      }
      if (hasProperty(params, 'current')) {
        this.service.updateCharacteristic(this.eveChar.ElectricCurrent, Number.parseFloat(params.current))
        logger = true
      }
      if (params.updateSource && logger && this.enableLogging) {
        this.log(
          '[%s] %s%s%s.',
          this.name,
          hasProperty(params, 'power')
            ? `${this.lang.curPower} [${params.power}W]`
            : '',
          hasProperty(params, 'voltage')
            ? ` ${this.lang.curVolt} [${params.voltage}V]`
            : '',
          hasProperty(params, 'current')
            ? ` ${this.lang.curCurr} [${params.current}A]`
            : '',
        )
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  destroy() {
    clearInterval(this.intervalPoll)
    clearInterval(this.intervalPower)
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }

  async currentState() {
    const toReturn = {}
    toReturn.services = ['outlet']
    toReturn.outlet = {
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
