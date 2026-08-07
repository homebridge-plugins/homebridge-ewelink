import { hasProperty } from '../utils/functions.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
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
    this.timeouts = {}
    this.lastTrigTimes = {};

    // Add the stateless switch services if they don't already exist
    [1, 2, 3, 4, 5, 6].forEach((label) => {
      this[`service${label}`] = this.accessory.getService(`Channel ${label}`)
      if (!this[`service${label}`]) {
        this[`service${label}`] = this.accessory.addService(
          this.hapServ.StatelessProgrammableSwitch,
          `Channel ${label}`,
          `channel${label}`,
        )

        // Add the ConfiguredName characteristic
        this[`service${label}`].addCharacteristic(this.hapChar.ConfiguredName)
        this[`service${label}`].updateCharacteristic(this.hapChar.ConfiguredName, `Channel ${label}`)

        // Add the ServiceLabelIndex characteristic
        this[`service${label}`].addCharacteristic(this.hapChar.ServiceLabelIndex)
        this[`service${label}`].updateCharacteristic(this.hapChar.ServiceLabelIndex, label)
      }

      this.timeouts[label] = false
    })

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable'
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    try {
      if (
        hasProperty(params, 'outlet')
        && [0, 1, 2, 3, 4, 5].includes(params.outlet)
        && params.actionTime
        && !this.timeouts[params.outlet + 1]
      ) {
        const label = params.outlet + 1

        // Skip duplicate events with same trigTime
        const trigKey = params.trigTime || params.actionTime
        if (this.lastTrigTimes[label] === trigKey) {
          return
        }
        this.lastTrigTimes[label] = trigKey

        this.timeouts[label] = true
        setTimeout(() => {
          this.timeouts[label] = false
        }, 1000)
        // actionTime may arrive as an ISO string or as an epoch-millis number
        // (the R5 sends a number); new Date() handles both, Date.parse() would
        // return NaN for the number and the button event would never fire (#762)
        const timeDiff = (Date.now() - new Date(params.actionTime).getTime()) / 1000
        if (timeDiff < 5) {
          const service = this[`service${label}`]
          service.updateCharacteristic(this.hapChar.ProgrammableSwitchEvent, params.key)
          if (params.updateSource && this.enableLogging) {
            const doubleLong = params.key === 1 ? this.lang.buttonDouble : this.lang.buttonLong
            const textLabel = params.key === 0 ? this.lang.buttonSingle : doubleLong
            if (this.enableLogging) {
              this.log(
                '[%s] [%s] %s [%s].',
                this.name,
                service.getCharacteristic(this.hapChar.ConfiguredName),
                this.lang.curState,
                textLabel,
              )
            }
          }
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
