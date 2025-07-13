export default class {
  constructor(api) {
    this.uuids = {
      currentConsumption: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
      totalConsumption: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
      voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
      electricCurrent: 'E863F126-079E-48FF-8F27-9C2605A29F52',
      resetTotal: 'E863F112-079E-48FF-8F27-9C2605A29F52',
      lastActivation: 'E863F11A-079E-48FF-8F27-9C2605A29F52',
      openDuration: 'E863F118-079E-48FF-8F27-9C2605A29F52',
      closedDuration: 'E863F119-079E-48FF-8F27-9C2605A29F52',
      timesOpened: 'E863F129-079E-48FF-8F27-9C2605A29F52',
    }

    const uuids = this.uuids

    this.CurrentConsumption = class extends api.hap.Characteristic {
      constructor() {
        super('Current Consumption', uuids.currentConsumption)
        this.setProps({
          format: api.hap.Formats.UINT16,
          unit: 'W',
          maxValue: 100000,
          minValue: 0,
          minStep: 1,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.TotalConsumption = class extends api.hap.Characteristic {
      constructor() {
        super('Total Consumption', uuids.totalConsumption)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'kWh',
          maxValue: 100000000000,
          minValue: 0,
          minStep: 0.01,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.Voltage = class extends api.hap.Characteristic {
      constructor() {
        super('Voltage', uuids.voltage)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'V',
          maxValue: 100000000000,
          minValue: 0,
          minStep: 1,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ElectricCurrent = class extends api.hap.Characteristic {
      constructor() {
        super('Electric Current', uuids.electricCurrent)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'A',
          maxValue: 100000000000,
          minValue: 0,
          minStep: 0.1,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ResetTotal = class extends api.hap.Characteristic {
      constructor() {
        super('Reset Total', uuids.resetTotal)
        this.setProps({
          format: api.hap.Formats.UINT32,
          unit: api.hap.Units.seconds,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.LastActivation = class extends api.hap.Characteristic {
      constructor() {
        super('Last Activation', uuids.lastActivation)
        this.setProps({
          format: api.hap.Formats.UINT32,
          unit: api.hap.Units.SECONDS,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.OpenDuration = class extends api.hap.Characteristic {
      constructor() {
        super('Open Duration', uuids.openDuration)
        this.setProps({
          format: api.hap.Formats.UINT32,
          unit: api.hap.Units.SECONDS,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ClosedDuration = class extends api.hap.Characteristic {
      constructor() {
        super('Closed Duration', uuids.closedDuration)
        this.setProps({
          format: api.hap.Formats.UINT32,
          unit: api.hap.Units.SECONDS,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.TimesOpened = class extends api.hap.Characteristic {
      constructor() {
        super('Times Opened', uuids.timesOpened)
        this.setProps({
          format: api.hap.Formats.UINT32,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.CurrentConsumption.UUID = this.uuids.currentConsumption
    this.TotalConsumption.UUID = this.uuids.totalConsumption
    this.Voltage.UUID = this.uuids.voltage
    this.ElectricCurrent.UUID = this.uuids.electricCurrent
    this.LastActivation.UUID = this.uuids.lastActivation
    this.ResetTotal.UUID = this.uuids.resetTotal
    this.OpenDuration.UUID = this.uuids.openDuration
    this.ClosedDuration.UUID = this.uuids.closedDuration
    this.TimesOpened.UUID = this.uuids.timesOpened
  }
}
