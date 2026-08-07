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
    const deviceConf = platform.rfSubdevices[accessory.context.hbDeviceId] || {}

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

    // If the accessory has a window covering service (from an old simulation) then remove it
    if (this.accessory.getService(this.hapServ.WindowCovering)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
    }

    // If the accessory has a door service (from an old simulation) then remove it
    if (this.accessory.getService(this.hapServ.Door)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
    }

    // If the accessory has a window service (from an old simulation) then remove it
    if (this.accessory.getService(this.hapServ.Window)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
    }

    // This instance is a remote control with buttons or curtain control
    Object.entries(this.accessory.context.buttons).forEach(([chan, name]) => {
      // For each curtain/button we create a separate switch service

      // Add the switch service if it doesn't already exist
      if (!this.accessory.getService(name)) {
        this.accessory.addService(this.hapServ.Switch, name, `switch${chan}`)
      }

      // Set the configured name so individual buttons display correctly
      this.accessory.getService(name).updateCharacteristic(this.hapChar.ConfiguredName, name)

      // Always start with the buttons off (useful when restarting Homebridge)
      this.accessory.getService(name).updateCharacteristic(this.hapChar.On, false)

      // Add the set handler to the switch on/off characteristic
      this.accessory
        .getService(name)
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => this.internalPressUpdate(chan, name, value))

      // Add the get handlers only if the user hasn't disabled the disableNoResponse setting
      if (!platform.config.disableNoResponse) {
        this.accessory
          .getService(name)
          .getCharacteristic(this.hapChar.On)
          .onGet(() => {
            if (!this.isOnline) {
              throw new this.hapErr(-70402)
            }
            return this.accessory.getService(name).getCharacteristic(this.hapChar.On).value
          })
      }
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalPressUpdate(rfChl, service, value) {
    try {
      if (!value) {
        return
      }
      const params = {
        cmd: 'transmit',
        rfChl: Number.parseInt(rfChl, 10),
      }
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.buttonTrig)
      }
      setTimeout(() => {
        this.accessory.getService(service).updateCharacteristic(this.hapChar.On, false)
      }, 1000)
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
      setTimeout(() => {
        this.accessory.getService(service).updateCharacteristic(this.hapChar.On, false)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  markStatus(isOnline) {
    this.isOnline = isOnline
  }
}
