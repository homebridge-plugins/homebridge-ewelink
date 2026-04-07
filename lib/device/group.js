import platformConsts from '../utils/constants.js'

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

    // Set the correct logging variables for this accessory
    this.enableLogging = !platform.config.disableDeviceLogging
    this.enableDebugLogging = platform.config.debug

    if (platformConsts.devices.switchSCM.includes(this.accessory.context.groupUIID)) {
      this.isSCM = true
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
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
      } else {
        params.switch = newValue
      }
      await this.platform.sendGroupUpdate(this.accessory, params)
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

  async externalUpdate(params) {
    try {
      if (!this.isSCM && params.switch && params.switch !== this.cacheState) {
        this.cacheState = params.switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
      if (this.isSCM && params.switches?.[0] && params.switches[0].switch !== this.cacheState) {
        this.cacheState = params.switches[0].switch
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
        this.accessory.eveService.addEntry({ status: this.cacheState === 'on' ? 1 : 0 })
        if (params.updateSource && this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }

  async currentState() {
    const toReturn = {}
    toReturn.services = ['switch']
    toReturn.switch = {
      state: this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off',
    }
    return toReturn
  }
}
