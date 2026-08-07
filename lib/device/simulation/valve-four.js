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
    this.disableTimer = deviceConf.disableTimer

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

    // We want four valve services for this accessory
    ['A', 'B', 'C', 'D'].forEach((v) => {
      // Add the valve service if it doesn't already exist
      let valveService = this.accessory.getService(`Valve ${v}`)
      if (!valveService) {
        valveService = this.accessory.addService(
          this.hapServ.Valve,
          `Valve ${v}`,
          `valve${v.toLowerCase()}`,
        )
        valveService.updateCharacteristic(this.hapChar.Active, 0)
        valveService.updateCharacteristic(this.hapChar.InUse, 0)
        if (!this.disableTimer) {
          valveService.updateCharacteristic(this.hapChar.ValveType, 1)
          valveService.updateCharacteristic(this.hapChar.SetDuration, 120)
          valveService.addCharacteristic(this.hapChar.RemainingDuration)
        }
      }

      // Add the set handler to the valve active characteristic
      valveService
        .getCharacteristic(this.hapChar.Active)
        .onSet(async value => this.internalUpdate(`Valve ${v}`, value))

      // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
      if (!platform.config.disableNoResponse) {
        valveService.getCharacteristic(this.hapChar.Active).onGet(() => {
          if (!this.isOnline) {
            throw new this.hapErr(-70402)
          }
          return valveService.getCharacteristic(this.hapChar.Active).value
        })
      }

      // Add the set handler to the valve set duration characteristic
      if (this.disableTimer) {
        if (valveService.testCharacteristic(this.hapChar.SetDuration)) {
          valveService.removeCharacteristic(
            valveService.getCharacteristic(this.hapChar.SetDuration),
          )
        }
        if (valveService.testCharacteristic(this.hapChar.RemainingDuration)) {
          valveService.removeCharacteristic(
            valveService.getCharacteristic(this.hapChar.RemainingDuration),
          )
        }
      } else {
        valveService.getCharacteristic(this.hapChar.SetDuration).onSet((value) => {
          // Check if the valve is currently active
          if (valveService.getCharacteristic(this.hapChar.InUse).value === 1) {
            // Update the remaining duration characteristic with the new value
            valveService.updateCharacteristic(this.hapChar.RemainingDuration, value)

            // Clear any existing active timers
            clearTimeout(valveService.timer)

            // Set a new active timer with the new time amount
            valveService.timer = setTimeout(
              () => valveService.setCharacteristic(this.hapChar.Active, 0),
              value * 1000,
            )
          }
        })
      }
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      disableTimer: this.disableTimer,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      showAs: 'valve_four',
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalUpdate(valve, value) {
    try {
      const params = {
        switches: [],
      }
      const valveService = this.accessory.getService(valve)
      switch (valve) {
        case 'Valve A':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 0 })
          break
        case 'Valve B':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 1 })
          break
        case 'Valve C':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 2 })
          break
        case 'Valve D':
          params.switches.push({ switch: value ? 'on' : 'off', outlet: 3 })
          break
        default:
          return
      }
      valveService.updateCharacteristic(this.hapChar.InUse, value)
      switch (value) {
        case 0:
          if (!this.disableTimer) {
            valveService.updateCharacteristic(this.hapChar.RemainingDuration, 0)
            clearTimeout(this.accessory.getService(valve).timer)
          }
          if (this.enableLogging) {
            this.log('[%s] [%s] %s [%s].', this.name, valve, this.lang.curState, this.lang.valveNo)
          }
          break
        case 1: {
          if (!this.disableTimer) {
            const timer = valveService.getCharacteristic(this.hapChar.SetDuration).value
            valveService.updateCharacteristic(this.hapChar.RemainingDuration, timer)
            valveService.timer = setTimeout(() => {
              valveService.setCharacteristic(this.hapChar.Active, 0)
            }, timer * 1000)
          }
          if (this.enableLogging) {
            this.log('[%s] [%s] %s [%s].', this.name, valve, this.lang.curState, this.lang.valveYes)
          }

          break
        }
        default:
          return
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      const valveService = this.accessory.getService(valve)
      setTimeout(() => {
        valveService.updateCharacteristic(this.hapChar.Active, value === 1 ? 0 : 1)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalUpdate(params) {
    try {
      if (!params.switches) {
        return
      }
      ['A', 'B', 'C', 'D'].forEach((v, k) => {
        const valveService = this.accessory.getService(`Valve ${v}`)
        if (params.switches[k].switch === 'on') {
          if (valveService.getCharacteristic(this.hapChar.Active).value === 0) {
            valveService.updateCharacteristic(this.hapChar.Active, 1)
            valveService.updateCharacteristic(this.hapChar.InUse, 1)
            if (!this.disableTimer) {
              const timer = valveService.getCharacteristic(this.hapChar.SetDuration).value
              valveService.updateCharacteristic(this.hapChar.RemainingDuration, timer)
              valveService.timer = setTimeout(() => {
                valveService.setCharacteristic(this.hapChar.Active, 0)
              }, timer * 1000)
            }
            if (params.updateSource && this.enableLogging) {
              this.log(
                '[%s] [Valve %s] %s [%s].',
                this.name,
                v,
                this.lang.curState,
                this.lang.valveYes,
              )
            }
          }
        } else if (valveService.getCharacteristic(this.hapChar.Active).value === 1) {
          valveService.updateCharacteristic(this.hapChar.Active, 0)
          valveService.updateCharacteristic(this.hapChar.InUse, 0)
          if (!this.disableTimer) {
            valveService.updateCharacteristic(this.hapChar.RemainingDuration, 0)
            clearTimeout(valveService.timer)
          } else if (params.updateSource && this.enableLogging) {
            this.log(
              '[%s] [Valve %s] %s [%s].',
              this.name,
              v,
              this.lang.curState,
              this.lang.valveNo,
            )
          }
        }
      })
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
