import fs from 'node:fs'

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

import platformConsts from '../utils/constants.js'

// Which config array each device category belongs in. The platform merges
// every array into one lookup by device id, so this only decides which set of
// options the schema editor shows next to the entry; anything not listed sits
// safely in singleDevices.
const categoryToArray = {
  switchMulti: 'multiDevices',
  switchMultiPower: 'multiDevices',
  panel: 'multiDevices',
  lightDimmer: 'lightDevices',
  lightRGB: 'lightDevices',
  lightCCT: 'lightDevices',
  lightRGBCCT: 'lightDevices',
  zbLightDimmer: 'lightDevices',
  zbLightCCT: 'lightDevices',
  zbLightRGBCCT: 'lightDevices',
  sensorAmbient: 'thDevices',
  thermostat: 'thDevices',
  fan: 'fanDevices',
  fanGear: 'fanDevices',
  rfBridge: 'rfDevices',
  sensorContact: 'sensorDevices',
  sensorTempHumi: 'sensorDevices',
  sensorAirQuality: 'sensorDevices',
  zbSensorAmbient: 'sensorDevices',
  zbSensorMotion: 'sensorDevices',
  zbSensorOccupancy: 'sensorDevices',
  zbSensorContact: 'sensorDevices',
  zbSensorWater: 'sensorDevices',
  zbSensorSmoke: 'sensorDevices',
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()

    // Used by the My Devices tab to know which config array a device belongs
    // in, built from the same uiid lists the plugin itself uses
    this.onRequest('/getUiidMap', () => {
      const uiidToArray = {}
      Object.entries(categoryToArray).forEach(([category, arrayKey]) => {
        (platformConsts.devices[category] || []).forEach((uiid) => {
          uiidToArray[uiid] = arrayKey
        })
      })
      return uiidToArray
    })

    /*
      A native method getCachedAccessories() was introduced in config-ui-x v4.37.0
      The following is for users who have a lower version of config-ui-x
    */
    this.onRequest('/getCachedAccessories', async () => {
      try {
        // Define the plugin and create the array to return
        const plugin = 'homebridge-ewelink'
        const devicesToReturn = []

        // The path and file of the cached accessories
        const accFile = `${this.homebridgeStoragePath}/accessories/cachedAccessories`

        // Check the file exists
        if (fs.existsSync(accFile)) {
          // Read the cached accessories file
          let cachedAccessories = await fs.promises.readFile(accFile)

          // Parse the JSON
          cachedAccessories = JSON.parse(cachedAccessories)

          // We only want the accessories for this plugin
          cachedAccessories
            .filter(accessory => accessory.plugin === plugin)
            .forEach(accessory => devicesToReturn.push(accessory))
        }

        // Return the array
        return devicesToReturn
      } catch (err) {
        // Just return an empty accessory list in case of any errors
        return []
      }
    })
    this.ready()
  }
}

(() => new PluginUiServer())()
