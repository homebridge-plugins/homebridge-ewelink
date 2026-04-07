import platformConsts from '../utils/constants.js'
import { hasProperty, sleep } from '../utils/functions.js'

export default class {
  constructor(platform, accessory, devicesInHB) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.devicesInHB = devicesInHB
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.hapUUIDGen = platform.api.hap.uuid.generate
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.accessory = accessory

    // Initially set the online flag as true (to be then updated as false if necessary)
    this.isOnline = true

    /*
    UIID 2/3/4/7/8/9/29/30/31/41/82/83/84/113/114: multi switch, no power readings
    UIID 126: multi switch, with wattage, voltage and amp readings (DUALR3)
    */

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}
    this.offlineAsOff = deviceConf.offlineAsOff
    this.hideChannels = deviceConf.hideChannels
    this.inchChannels = deviceConf.inchChannels || ''
    this.inUsePowerThreshold = deviceConf.inUsePowerThreshold || platformConsts.defaultValues.inUsePowerThreshold
    accessory.context.isInched = accessory.context.switchNumber !== '0'
      && this.inchChannels.includes(accessory.context.switchNumber)

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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Outlet)
      || this.accessory.addService(this.hapServ.Outlet)

    if (platformConsts.devices.switchMultiPower.includes(this.accessory.context.eweUIID)) {
      // Add Eve power characteristics
      this.powerReadings = true
      this.isDual = true
      if (accessory.context.switchNumber !== '0') {
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
      }
    } else {
      // Remove unused Eve characteristics
      if (this.service.testCharacteristic(this.hapChar.OutletInUse)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.OutletInUse))
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
    }

    // Add the set handler to the outlet on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Add a custom characteristic for inverting the switch if inching setting is enabled
    if (this.accessory.context.isInched) {
      if (!this.service.testCharacteristic(this.cusChar.InvertSwitch)) {
        this.service.addCharacteristic(this.cusChar.InvertSwitch)
      }
      this.service.updateCharacteristic(
        this.cusChar.InvertSwitch,
        this.service.getCharacteristic(this.hapChar.On).value,
      )

      // Add the set handler to invert the switch
      this.service.getCharacteristic(this.cusChar.InvertSwitch).onSet((value) => {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.log('[%s] %s [%s].', this.name, this.lang.curState, value ? 'on' : 'off')
      })
    }

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
    if (
      this.powerReadings
      && accessory.context.switchNumber === '0'
      && platform.config.mode !== 'lan'
    ) {
      // Set up an interval to get eWeLink to send power updates
      setTimeout(() => {
        this.internalUIUpdate()
        this.intervalPoll = setInterval(() => this.internalUIUpdate(), 120000)
      }, 5000)
    }

    // Output the customised options to the log
    if (accessory.context.switchNumber === '0') {
      const normalLogging = this.enableLogging ? 'standard' : 'disable'
      const opts = JSON.stringify({
        hideChannels: this.hideChannels,
        inchChannels: this.inchChannels,
        inUsePowerThreshold: this.inUsePowerThreshold,
        logging: this.enableDebugLogging ? 'debug' : normalLogging,
        showAs: 'outlet',
      })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }
  }

  async internalStateUpdate(value) {
    try {
      let primaryState = false
      if (this.accessory.context.isInched) {
        value = !this.service.getCharacteristic(this.hapChar.On).value
      }
      const params = {
        switches: [],
      }
      const { switchNumber } = this.accessory.context
      switch (switchNumber) {
        case '0':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 0 })
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 1 })
          if (!this.isDual) {
            params.switches.push({ switch: value ? 'on' : 'off', outlet: 2 })
            params.switches.push({ switch: value ? 'on' : 'off', outlet: 3 })
          }
          break
        case '1':
        case '2':
        case '3':
        case '4': {
          const isZigbee = [2256, 3256, 4256, 7029].includes(this.accessory.context.eweUIID)
          if (isZigbee) {
            for (let i = 1; i <= this.accessory.context.channelCount; i += 1) {
              if (i === Number.parseInt(switchNumber, 10)) {
                params.switches.push({
                  switch: value || this.accessory.context.isInched ? 'on' : 'off',
                  outlet: i - 1,
                })
              } else {
                const uuid = this.hapUUIDGen(`${this.accessory.context.eweDeviceId}SW${i}`)
                const sub = this.devicesInHB.get(uuid)
                const curVal = sub?.getService(this.hapServ.Outlet)
                  ?.getCharacteristic(this.hapChar.On)
                  ?.value ?? false
                params.switches.push({ switch: curVal ? 'on' : 'off', outlet: i - 1 })
              }
            }
          } else {
            params.switches.push({
              switch: value || this.accessory.context.isInched ? 'on' : 'off',
              outlet: switchNumber - 1,
            })
          }
          break
        }
        default:
          return
      }
      if (this.accessory.context.isInched) {
        this.accessory.context.ignoreUpdates = true
        setTimeout(() => {
          this.accessory.context.ignoreUpdates = false
        }, 1500)
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (this.accessory.context.isInched) {
        this.service.updateCharacteristic(this.cusChar.InvertSwitch, value)
      }
      switch (switchNumber) {
        case '0':
          for (let i = 0; i <= this.accessory.context.channelCount; i += 1) {
            const idToCheck = `${this.accessory.context.eweDeviceId}SW${i}`
            const uuid = this.hapUUIDGen(idToCheck)
            if (this.devicesInHB.has(uuid)) {
              const subAccessory = this.devicesInHB.get(uuid)
              const service = subAccessory.getService(this.hapServ.Outlet)
              service.updateCharacteristic(this.hapChar.On, value)
              subAccessory.eveService.addEntry({ status: value ? 1 : 0 })
              if (i > 0) {
                if (this.enableLogging) {
                  this.log(
                    '[%s] %s [%s].',
                    subAccessory.displayName,
                    this.lang.curState,
                    value ? 'on' : 'off',
                  )
                }
              }
            }
          }
          break
        case '1':
        case '2':
        case '3':
        case '4':
          for (let i = 1; i <= this.accessory.context.channelCount; i += 1) {
            const idToCheck = `${this.accessory.context.eweDeviceId}SW${i}`
            const uuid = this.hapUUIDGen(idToCheck)
            if (this.devicesInHB.has(uuid)) {
              const subAccessory = this.devicesInHB.get(uuid)
              const service = subAccessory.getService(this.hapServ.Outlet)
              if (i === Number.parseInt(switchNumber, 10)) {
                if (value) {
                  primaryState = true
                }
                subAccessory.eveService.addEntry({ status: value ? 1 : 0 })
                if (i > 0) {
                  if (this.enableLogging) {
                    this.log(
                      '[%s] %s [%s].',
                      subAccessory.displayName,
                      this.lang.curState,
                      value ? 'on' : 'off',
                    )
                  }
                }
              } else if (service.getCharacteristic(this.hapChar.On).value) {
                primaryState = true
              }
            }
          }
          if (!this.platform.hideMasters.includes(this.accessory.context.eweDeviceId)) {
            const idToCheck = `${this.accessory.context.eweDeviceId}SW0`
            const uuid = this.hapUUIDGen(idToCheck)
            const priAccessory = this.devicesInHB.get(uuid)
            priAccessory
              .getService(this.hapServ.Outlet)
              .updateCharacteristic(this.hapChar.On, primaryState)
            priAccessory.eveService.addEntry({ status: primaryState ? 1 : 0 })
          }
          break
        default:
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, !value)
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
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 0, time: 120 } })
      await sleep(2000)
      await this.platform.sendDeviceUpdate(this.accessory, { uiActive: { outlet: 1, time: 120 } })
    } catch (err) {
      // Suppress errors here
    }
  }

  async externalUpdate(params) {
    try {
      const idToCheck = `${this.accessory.context.eweDeviceId}SW`
      let primaryState = false
      for (let i = 1; i <= this.accessory.context.channelCount; i += 1) {
        const uuid = this.hapUUIDGen(idToCheck + i)
        if (this.devicesInHB.has(uuid)) {
          const subAccessory = this.devicesInHB.get(uuid)
          const service = subAccessory.getService(this.hapServ.Outlet)
          if (params.switches && params.switches[i - 1]) {
            const currentState = service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'
            if (subAccessory.context.isInched) {
              if (params.switches[i - 1].switch === 'on' && !subAccessory.context.ignoreUpdates) {
                subAccessory.context.ignoreUpdates = true
                setTimeout(() => {
                  subAccessory.context.ignoreUpdates = false
                }, 1500)
                const newState = currentState === 'on' ? 'off' : 'on'
                if (newState === 'on') {
                  primaryState = true
                }
                service.updateCharacteristic(this.hapChar.On, newState === 'on')
                service.updateCharacteristic(this.cusChar.InvertSwitch, newState === 'on')
                subAccessory.eveService.addEntry({
                  status: newState === 'on' ? 1 : 0,
                })
                if (params.updateSource && this.enableLogging) {
                  this.log('[%s] %s [%s].', subAccessory.displayName, this.lang.curState, newState)
                }
              }
            } else {
              if (params.switches[i - 1].switch === 'on') {
                primaryState = true
              }
              if (!params.updateSource || params.switches[i - 1].switch !== currentState) {
                service.updateCharacteristic(
                  this.hapChar.On,
                  params.switches[i - 1].switch === 'on',
                )
                subAccessory.eveService.addEntry({
                  status: params.switches[i - 1].switch === 'on' ? 1 : 0,
                })
                if (params.updateSource && this.enableLogging) {
                  this.log(
                    '[%s] %s [%s].',
                    subAccessory.displayName,
                    this.lang.curState,
                    params.switches[i - 1].switch,
                  )
                }
              }
            }
          }
          if (this.powerReadings) {
            let logger = false
            let power
            let voltage
            let current
            if (hasProperty(params, `actPow_0${i - 1}`)) {
              power = Number.parseInt(params[`actPow_0${i - 1}`], 10) / 100
              service.updateCharacteristic(
                this.hapChar.OutletInUse,
                service.getCharacteristic(this.hapChar.On).value && power > this.inUsePowerThreshold,
              )
              service.updateCharacteristic(this.eveChar.CurrentConsumption, power)
              subAccessory.eveService.addEntry({ power })
              logger = true
            }
            if (hasProperty(params, `voltage_0${i - 1}`)) {
              voltage = Number.parseInt(params[`voltage_0${i - 1}`], 10) / 100
              service.updateCharacteristic(this.eveChar.Voltage, voltage)
              logger = true
            }
            if (hasProperty(params, `current_0${i - 1}`)) {
              current = Number.parseInt(params[`current_0${i - 1}`], 10) / 100
              service.updateCharacteristic(this.eveChar.ElectricCurrent, current)
              logger = true
            }
            if (params.updateSource && logger && this.enableLogging) {
              this.log(
                '[%s] %s%s%s.',
                subAccessory.displayName,
                power !== undefined ? `${this.lang.curPower} [${power}W]` : '',
                voltage !== undefined ? ` ${this.lang.curVolt} [${voltage}V]` : '',
                current !== undefined ? ` ${this.lang.curCurr} [${current}A]` : '',
              )
            }
          }
        }
      }
      if (
        !this.platform.hideMasters.includes(this.accessory.context.eweDeviceId)
        && params.switches
      ) {
        this.service.updateCharacteristic(this.hapChar.On, primaryState)
        this.accessory.eveService.addEntry({ status: primaryState ? 1 : 0 })
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
    if (this.offlineAsOff && !isOnline && this.cacheState !== 'off') {
      this.service.updateCharacteristic(this.hapChar.On, false)
      this.cacheState = 'off'
      if (this.enableLogging) {
        this.log('[%s] %s [%s - offline]', this.name, this.lang.curState, this.cacheState)
      }
    }
  }

  currentState() {
    const toReturn = {}
    toReturn.services = ['outlet']
    toReturn.outlet = {
      state: this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
    }
    return toReturn
  }
}
