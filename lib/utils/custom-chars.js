import { inherits } from 'node:util'

export default class {
  constructor(api) {
    this.hapServ = api.hap.Service
    this.hapChar = api.hap.Characteristic
    this.uuids = {
      invertSwitch: 'E965F001-079E-48FF-8F27-9C2605A29F52',
      festiveScene: 'E965F002-079E-48FF-8F27-9C2605A29F52',
    }
    const self = this
    this.InvertSwitch = function InvertSwitch() {
      self.hapChar.call(this, 'Invert Switch', self.uuids.invertSwitch)
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
    this.FestiveScene = function FestiveScene() {
      self.hapChar.call(this, 'Festive Scene', self.uuids.festiveScene)
      this.setProps({
        format: api.hap.Formats.BOOL,
        perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
    inherits(this.InvertSwitch, this.hapChar)
    inherits(this.FestiveScene, this.hapChar)
    this.InvertSwitch.UUID = this.uuids.invertSwitch
    this.FestiveScene.UUID = this.uuids.festiveScene
  }
}
