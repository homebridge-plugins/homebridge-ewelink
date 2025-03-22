import { inherits } from 'node:util'

export default class {
  constructor(api) {
    this.hapServ = api.hap.Service
    this.hapChar = api.hap.Characteristic
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
    const self = this
    this.CurrentConsumption = function CurrentConsumption() {
      self.hapChar.call(this, 'Current Consumption', self.uuids.currentConsumption)
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
    this.TotalConsumption = function TotalConsumption() {
      self.hapChar.call(this, 'Total Consumption', self.uuids.totalConsumption)
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
    this.Voltage = function Voltage() {
      self.hapChar.call(this, 'Voltage', self.uuids.voltage)
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
    this.ElectricCurrent = function ElectricCurrent() {
      self.hapChar.call(this, 'Electric Current', self.uuids.electricCurrent)
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
    this.ResetTotal = function ResetTotal() {
      self.hapChar.call(this, 'Reset Total', self.uuids.resetTotal)
      this.setProps({
        format: api.hap.Formats.UINT32,
        unit: api.hap.Units.seconds,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
      })
      this.value = this.getDefaultValue()
    }
    this.LastActivation = function LastActivation() {
      self.hapChar.call(this, 'Last Activation', self.uuids.lastActivation)
      this.setProps({
        format: api.hap.Formats.UINT32,
        unit: api.hap.Units.SECONDS,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
    this.OpenDuration = function OpenDuration() {
      self.hapChar.call(this, 'Open Duration', self.uuids.openDuration)
      this.setProps({
        format: api.hap.Formats.UINT32,
        unit: api.hap.Units.SECONDS,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
      })
      this.value = this.getDefaultValue()
    }
    this.ClosedDuration = function ClosedDuration() {
      self.hapChar.call(this, 'Closed Duration', self.uuids.closedDuration)
      this.setProps({
        format: api.hap.Formats.UINT32,
        unit: api.hap.Units.SECONDS,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY, api.hap.Perms.PAIRED_WRITE],
      })
      this.value = this.getDefaultValue()
    }
    this.TimesOpened = function TimesOpened() {
      self.hapChar.call(this, 'Times Opened', self.uuids.timesOpened)
      this.setProps({
        format: api.hap.Formats.UINT32,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
    inherits(this.CurrentConsumption, this.hapChar)
    inherits(this.TotalConsumption, this.hapChar)
    inherits(this.Voltage, this.hapChar)
    inherits(this.ElectricCurrent, this.hapChar)
    inherits(this.LastActivation, this.hapChar)
    inherits(this.ResetTotal, this.hapChar)
    inherits(this.OpenDuration, this.hapChar)
    inherits(this.ClosedDuration, this.hapChar)
    inherits(this.TimesOpened, this.hapChar)
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
