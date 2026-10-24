import { generateRandomString, hasProperty } from '../../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.hapErr = platform.api.hap.HapStatusError
    this.log = platform.log
    this.platform = platform
    this.lang = platform.lang
    this.name = accessory.displayName
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {}

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

    // The newer SWV-ZNE irrigation valve (uiid 7047) reports and accepts its
    // state under 'switch_00' rather than 'switch' (#778). The two-zone
    // SWV-ZF2E (uiid 7048) does the same, with its second valve on 'switch_01'.
    if (accessory.context.eweUIID === 7048) {
      this.zones = [
        { param: 'switch_00', label: 'Valve 1', subtype: 'valve1' },
        { param: 'switch_01', label: 'Valve 2', subtype: 'valve2' },
      ]
    } else {
      this.zones = [
        {
          param: accessory.context.eweUIID === 7047
            ? 'switch_00'
            : 'switch',
        },
      ]
    }
    this.zones.forEach(zone => this.setUpZone(zone))

    this.log('[%s] initialized as a Zigbee Smart Water Valve.', this.name)
  }

  setUpZone(zone) {
    // Initialize cache state and timer references
    zone.cacheState = false
    zone.timer = null
    zone.updateInterval = null

    // A single valve keeps the service, name and saved timer it has always had
    zone.name = zone.label
      ? `${this.name} ${zone.label}`
      : this.name
    zone.timerKey = zone.subtype
      ? `timerEndTime_${zone.subtype}`
      : 'timerEndTime'

    // Set up the Valve Service for HomeKit
    zone.service = zone.subtype
      ? this.accessory.getServiceById(this.hapServ.Valve, zone.subtype)
      : this.accessory.getService(this.hapServ.Valve)
    if (!zone.service) {
      zone.service = zone.subtype
        ? this.accessory.addService(this.hapServ.Valve, zone.label, zone.subtype)
        : this.accessory.addService(this.hapServ.Valve)
      zone.service.updateCharacteristic(this.hapChar.Active, 0)
      zone.service.updateCharacteristic(this.hapChar.InUse, 0)
      zone.service.updateCharacteristic(this.hapChar.ValveType, 1) // 1 = Irrigation
      zone.service.updateCharacteristic(this.hapChar.SetDuration, 30) // Default timer duration
      zone.service.addCharacteristic(this.hapChar.RemainingDuration)
    }

    // Restore timer state if it exists
    if (this.accessory.context[zone.timerKey]) {
      const now = Date.now()
      if (now < this.accessory.context[zone.timerKey]) {
        // Timer should still be running
        const remainingTime = Math.round((this.accessory.context[zone.timerKey] - now) / 1000)
        zone.service.updateCharacteristic(this.hapChar.RemainingDuration, remainingTime)
        this.startTimer(zone, remainingTime)
      } else {
        // Timer has expired, clean up
        zone.service.updateCharacteristic(this.hapChar.Active, 0)
        zone.service.updateCharacteristic(this.hapChar.InUse, 0)
        zone.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
        delete this.accessory.context[zone.timerKey]
      }
    }

    // Set up event handlers for Active characteristic
    zone.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async (value) => {
        const prevState = zone.cacheState
        try {
          const newState = value === 1

          // HomeKit can send the same command several times over, so ignore
          // anything that asks the valve to do what it is already doing (#778)
          if (newState === zone.cacheState) {
            return
          }

          // Claim the new state before sending, so repeats that arrive while
          // this command is still in flight are ignored too
          zone.cacheState = newState

          // The device can echo a superseded state back after a newer command
          // has been sent, flipping HomeKit to a state we have already left
          // behind - suppress incoming updates around a command, the same way
          // the other device types do (#778)
          this.suppressUpdates(zone)

          if (this.enableLogging) {
            this.log('[%s] Setting valve to [%s]', zone.name, newState ? 'On' : 'Off')
          }

          // Send command to the device
          await this.platform.sendDeviceUpdate(this.accessory, {
            [zone.param]: newState,
          })

          // Update InUse characteristic to match Active
          zone.service.updateCharacteristic(this.hapChar.InUse, value)

          if (value === 1) {
            // If turning on, start the timer
            const duration = zone.service.getCharacteristic(this.hapChar.SetDuration).value
            this.startTimer(zone, duration)
          } else {
            // If turning off, clear the timer and reset remaining duration
            this.clearTimer(zone)
          }
        } catch (err) {
          // Revert the characteristic state on error
          zone.cacheState = prevState
          const prevValue = prevState ? 1 : 0
          zone.service.updateCharacteristic(this.hapChar.Active, prevValue)
          zone.service.updateCharacteristic(this.hapChar.InUse, prevValue)
          this.platform.deviceUpdateError(this.accessory, err, false)
          throw new this.hapErr(-70402)
        }
      })

    // Set up handler for SetDuration characteristic
    zone.service.getCharacteristic(this.hapChar.SetDuration)
      .onSet((value) => {
        if (zone.service.getCharacteristic(this.hapChar.InUse).value === 1) {
          // Update timer with new duration if valve is currently active
          this.startTimer(zone, value)
        }
      })
  }

  suppressUpdates(zone) {
    // Ignore this valve's incoming state for a few seconds
    const timerKey = generateRandomString(5)
    zone.updateTimeout = timerKey
    setTimeout(() => {
      if (zone.updateTimeout === timerKey) {
        zone.updateTimeout = false
      }
    }, 5000)
  }

  startTimer(zone, duration) {
    // Clear any existing timer
    this.clearTimer(zone)

    // Set timer end time and store it in context
    this.accessory.context[zone.timerKey] = Date.now() + (duration * 1000)

    // Update remaining duration
    zone.service.updateCharacteristic(this.hapChar.RemainingDuration, duration)

    // Set new timer
    zone.timer = setTimeout(async () => {
      try {
        // Suppress incoming updates around this command too, so an echo of
        // the earlier On cannot land after the Off we are about to send (#778)
        this.suppressUpdates(zone)

        // Send explicit command to turn off the valve
        await this.platform.sendDeviceUpdate(this.accessory, {
          [zone.param]: false,
        })

        // Update HomeKit characteristics
        zone.service.updateCharacteristic(this.hapChar.Active, 0)
        zone.service.updateCharacteristic(this.hapChar.InUse, 0)
        zone.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
        delete this.accessory.context[zone.timerKey]

        // Update cache state
        zone.cacheState = false

        if (this.enableLogging) {
          this.log('[%s] Timer finished - turning valve [OFF]', zone.name)
        }
      } catch (err) {
        this.platform.deviceUpdateError(this.accessory, err, false)
      }
    }, duration * 1000)

    // Start a periodic update of remaining duration
    if (zone.updateInterval) {
      clearInterval(zone.updateInterval)
      zone.updateInterval = null
    }
    zone.updateInterval = setInterval(() => {
      const remaining = Math.round((this.accessory.context[zone.timerKey] - Date.now()) / 1000)
      if (remaining > 0) {
        zone.service.updateCharacteristic(this.hapChar.RemainingDuration, remaining)
      } else {
        clearInterval(zone.updateInterval)
        zone.updateInterval = null
      }
    }, 1000)
  }

  clearTimer(zone) {
    if (zone.timer) {
      clearTimeout(zone.timer)
      zone.timer = null
    }
    if (zone.updateInterval) {
      clearInterval(zone.updateInterval)
      zone.updateInterval = null
    }
    delete this.accessory.context[zone.timerKey]
    zone.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
  }

  async externalUpdate(params) {
    try {
      this.zones.forEach((zone) => {
        // Ignore updates while a command we sent is settling - they can carry
        // the state we have just moved away from (#778)
        if (zone.updateTimeout || !hasProperty(params, zone.param)) {
          return
        }

        // Handle On/Off state
        const newState = !!params[zone.param]
        if (newState !== zone.cacheState) {
          zone.cacheState = newState
          const value = newState ? 1 : 0
          zone.service.updateCharacteristic(this.hapChar.Active, value)
          zone.service.updateCharacteristic(this.hapChar.InUse, value)

          if (!newState) {
            // If turned off externally, clear timer
            this.clearTimer(zone)
          }

          if (params.updateSource && this.enableLogging) {
            this.log('[%s] Valve state updated to [%s]', zone.name, newState ? 'On' : 'Off')
          }
        }
      })
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  destroy() {
    this.zones.forEach((zone) => {
      clearTimeout(zone.timer)
      clearInterval(zone.updateInterval)
    })
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
