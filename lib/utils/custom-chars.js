export default class {
  constructor(api) {
    this.uuids = {
      invertSwitch: 'E965F001-079E-48FF-8F27-9C2605A29F52',
      festiveScene: 'E965F002-079E-48FF-8F27-9C2605A29F52',
    }

    const uuids = this.uuids

    this.InvertSwitch = class extends api.hap.Characteristic {
      constructor() {
        super('Invert Switch', uuids.invertSwitch)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.FestiveScene = class extends api.hap.Characteristic {
      constructor() {
        super('Festive Scene', uuids.festiveScene)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.InvertSwitch.UUID = this.uuids.invertSwitch
    this.FestiveScene.UUID = this.uuids.festiveScene
  }
}
