import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'

import storage from 'node-persist'
import PQueue from 'p-queue'

import apiClient from './connection/api.js'
import httpClient from './connection/http.js'
import lanClient from './connection/lan.js'
import wsClient from './connection/ws.js'
import deviceTypes from './device/index.js'
import eveService from './fakegato/fakegato-history.js'
import platformConsts from './utils/constants.js'
import platformChars from './utils/custom-chars.js'
import eveChars from './utils/eve-chars.js'
import { parseDeviceId, parseError } from './utils/functions.js'
import platformLang from './utils/lang.js'

const require = createRequire(import.meta.url)
const plugin = require('../package.json')

const devicesInHB = new Map()
const queue = new PQueue({
  interval: 250,
  intervalCap: 1,
  timeout: 10000,
})

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.log = log
      this.isBeta = process.argv.includes('-D')
      this.apiClient = false
      this.apiServer = false
      this.httpClient = false
      this.lanClient = false
      this.lanDevices = false
      this.wsClient = false

      // Configuration objects for accessories
      this.deviceConf = {}
      this.rfSubdevices = {}
      this.hideChannels = []
      this.hideMasters = []
      this.ignoredDevices = []
      this.ipOverride = {}
      this.obstructSwitches = {}

      // Retrieve the user's chosen language file
      const lang = platformConsts.allowed.language.includes(config.language)
        ? config.language
        : platformConsts.defaultValues.language
      this.lang = platformLang[lang]

      // Make sure user is running Homebridge v1.5 or above
      if (!api?.versionGreaterOrEqual('1.5.0')) {
        throw new Error(this.lang.hbVersionFail)
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(this.lang.pluginNotConf)
      }

      // Log some environment info for debugging
      this.log(
        '%s v%s | System %s | Node %s | HB v%s | HAPNodeJS v%s...',
        this.lang.initialising,
        plugin.version,
        process.platform,
        process.version,
        api.serverVersion,
        api.hap.HAPLibraryVersion(),
      )

      // Apply the user's configuration
      this.config = platformConsts.defaultConfig
      this.applyUserConfig(config)

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      const eText = parseError(err, [this.lang.hbVersionFail, this.lang.pluginNotConf])
      log.warn('***** %s. *****', this.lang.disabling)
      log.warn('***** %s. *****', eText)
    }
  }

  applyUserConfig(config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgDef, def)
    }
    const logDuplicate = (k) => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgDup)
    }
    const logIgnore = (k) => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgn)
    }
    const logIgnoreItem = (k) => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgnItem)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgLow, min)
    }
    const logQuotes = (k) => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgQts)
    }
    const logRemove = (k) => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgRmv)
    }

    // Begin applying the user's config
    Object.entries(config).forEach((entry) => {
      const [key, val] = entry
      switch (key) {
        case 'apiPort': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const intVal = Number.parseInt(val, 10)
          if (Number.isNaN(intVal)) {
            logDefault(key, platformConsts.defaultValues[key])
            this.config.apiPort = platformConsts.defaultValues[key]
          } else if (intVal < platformConsts.minValues[key]) {
            logIncrease(key, platformConsts.minValues[key])
            this.config.apiPort = platformConsts.minValues[key]
          } else {
            this.config.apiPort = intVal
          }
          break
        }
        case 'appId':
        case 'appSecret':
        case 'ignoredHomes':
        case 'username':
          if (typeof val !== 'string') {
            logIgnore(key)
          } else {
            this.config[key] = val.replace(/\s+/g, '')
          }
          break
        case 'bridgeSensors':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((x) => {
              if (!x.fullDeviceId) {
                logIgnoreItem(key)
                return
              }
              const id = parseDeviceId(x.fullDeviceId)
              if (Object.keys(this.rfSubdevices).includes(id)) {
                logDuplicate(`${key}.${id}`)
                return
              }
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(`${key}.${id}`)
                return
              }
              this.rfSubdevices[id] = {}
              entries.forEach((subEntry) => {
                const [k, v] = subEntry
                switch (k) {
                  case 'curtainType':
                  case 'deviceType':
                  case 'type': {
                    const index = k === 'type' ? 'sensorType' : k
                    const inSet = platformConsts.allowed[index].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.rfSubdevices[id][k] = inSet ? v : platformConsts.defaultValues[k]
                    }
                    break
                  }
                  case 'fullDeviceId':
                  case 'label':
                    break
                  case 'operationTime':
                  case 'operationTimeDown':
                  case 'sensorTimeDifference':
                  case 'sensorTimeLength': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    const intVal = Number.parseInt(v, 10)
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k])
                      this.rfSubdevices[id][k] = platformConsts.defaultValues[k]
                    } else if (intVal < platformConsts.minValues[k]) {
                      logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k])
                      this.rfSubdevices[id][k] = platformConsts.minValues[k]
                    } else {
                      this.rfSubdevices[id][k] = intVal
                    }
                    break
                  }
                  case 'sensorWebHook':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.rfSubdevices[id][k] = v
                    }
                    break
                  default:
                    logRemove(`${key}.${id}.${k}`)
                    break
                }
              })
            })
          } else {
            logIgnore(key)
          }
          break
        case 'countryCode':
          if (typeof val !== 'string' || val === '') {
            logIgnore(key)
          } else {
            this.config.countryCode = `+${val.replace(/\D/g, '')}`
          }
          break
        case 'disableDeviceLogging':
        case 'disableNoResponse':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'fanDevices':
        case 'lightDevices':
        case 'multiDevices':
        case 'rfDevices':
        case 'sensorDevices':
        case 'singleDevices':
        case 'thDevices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((x) => {
              if (!x.deviceId) {
                logIgnoreItem(key)
                return
              }
              const id = parseDeviceId(x.deviceId)
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(`${key}.${id}`)
                return
              }
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(`${key}.${id}`)
                return
              }
              this.deviceConf[id] = {}
              entries.forEach((subEntry) => {
                const [k, v] = subEntry
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'inUsePowerThreshold':
                  case 'lowBattThreshold':
                  case 'minTarget':
                  case 'maxTarget':
                  case 'operationTime':
                  case 'operationTimeDown':
                  case 'sensorTimeDifference': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    const intVal = Number.parseInt(v, 10)
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k])
                      this.deviceConf[id][k] = platformConsts.defaultValues[k]
                    } else if (intVal < platformConsts.minValues[k]) {
                      logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k])
                      this.deviceConf[id][k] = platformConsts.minValues[k]
                    } else {
                      this.deviceConf[id][k] = intVal
                    }
                    break
                  }
                  case 'deviceId':
                  case 'label':
                    break
                  case 'deviceModel':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else if (!platformConsts.allowed.models[key].includes(v)) {
                      logIgnore(`${key}.${id}.${k}`)
                    } else if (v === 'gddc5' && key === 'singleDevices') {
                      this.deviceConf[id].showAs = 'garage_eachen'
                    }
                    break
                  case 'disableTimer':
                  case 'hideLight':
                  case 'hideLongDouble':
                  case 'hideSensor':
                  case 'hideSwitch':
                  case 'humidityOffsetFactor':
                  case 'isInched':
                  case 'offlineAsOff':
                  case 'offsetFactor':
                  case 'resetOnStartup':
                  case 'scaleBattery':
                  case 'showHeatCool':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    this.deviceConf[id][k] = v === 'false' ? false : !!v
                    break
                  case 'hideChannels': {
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      const channels = v.split(',')
                      channels.forEach((channel) => {
                        this.hideChannels.push(`${id}SW${channel.replace(/\D+/g, '')}`)
                        this.deviceConf[id][k] = v
                      })
                    }
                    break
                  }
                  case 'humidityOffset':
                  case 'offset':
                  case 'targetTempThreshold': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    const numVal = Number(v)
                    if (Number.isNaN(numVal)) {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = numVal
                    }
                    break
                  }
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id)
                    }
                    break
                  case 'inchChannels':
                  case 'temperatureSource':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = v
                    }
                    break
                  case 'ipAddress': {
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.ipOverride[id] = v
                    }
                    break
                  }
                  case 'obstructId':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      const parsed = parseDeviceId(v)
                      this.deviceConf[id][k] = parsed
                      this.obstructSwitches[parsed] = id
                    }
                    break
                  case 'sensorId':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id].sensorId = parseDeviceId(v)
                    }
                    break
                  case 'sensorType':
                  case 'showAs':
                  case 'showAsEachen':
                  case 'showAsMotor': {
                    const inSet = platformConsts.allowed[k].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = inSet ? v : platformConsts.defaultValues[k]
                    }
                    break
                  }
                  default:
                    logRemove(`${key}.${id}.${k}`)
                }
              })
            })
          } else {
            logIgnore(key)
          }
          break
        case 'httpHost': {
          const inSet = platformConsts.allowed.httpHosts.includes(val)
          if (typeof val !== 'string' || !inSet) {
            logIgnore(key)
          }
          const defaultAutoHost = val === 'auto' ? platformConsts.defaultValues[key] : val
          this.config.httpHost = inSet ? defaultAutoHost : platformConsts.defaultValues[key]
          break
        }
        case 'language':
        case 'mode': {
          const inSet = platformConsts.allowed[key].includes(val)
          if (typeof val !== 'string' || !inSet) {
            logIgnore(key)
          }
          this.config[key] = inSet ? val : platformConsts.defaultValues[key]
          break
        }
        case 'name':
        case 'platform':
          break
        case 'password':
          if (typeof val !== 'string') {
            logIgnore(key)
          } else {
            this.config.password = val
          }
          break
        default:
          logRemove(key)
          break
      }
    })
  }

  async pluginSetup() {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', this.lang.initialised)

      // Sort out some logging functions
      if (this.isBeta) {
        this.log.debug = this.log
        this.log.debugWarn = this.log.warn
      } else {
        this.log.debug = () => {}
        this.log.debugWarn = () => {}
      }

      // Check the eWeLink credentials are configured (except lan mode)
      if (this.config.mode !== 'lan' && (!this.config.username || !this.config.password)) {
        devicesInHB.forEach(accessory => this.removeAccessory(accessory))
        throw new Error(this.lang.missingCreds)
      }

      // Require any libraries that the accessory instances use
      this.cusChar = new platformChars(this.api)
      this.eveChar = new eveChars(this.api)
      this.eveService = eveService(this.api)

      // Persist files are used to store device info that could be used for LAN only mode
      try {
        this.storageLAN = storage.create({
          dir: join(this.api.user.persistPath(), '/../homebridge-ewelink'),
          forgiveParseErrors: true,
        })
        await this.storageLAN.init()
        this.storageClientLAN = true
      } catch (err) {
        this.log.debugWarn(`${this.lang.storageSetupErr} ${parseError(err)}`)
      }

      // Persist files are used to store device info that can be used by my other plugins
      try {
        this.storageData = storage.create({
          dir: join(this.api.user.persistPath(), '/../bwp91_cache'),
          forgiveParseErrors: true,
        })
        await this.storageData.init()
        this.storageClientData = true
        this.temperatureCache = new Map()
      } catch (err) {
        this.log.debugWarn(`${this.lang.storageSetupErr} ${parseError(err)}`)
      }

      // Manually disable no response mode if mode is set to lan
      if (this.config.mode === 'lan') {
        this.config.disableNoResponse = true
      }

      const deviceList = []
      const groupList = []

      // Username and password are optional
      if (this.config.username && this.config.password) {
        // Set up the HTTP client, get the user HTTP host, and login
        this.httpClient = new httpClient(this)
        const authData = await this.httpClient.login()
        this.config.password = authData.password

        // Get a home and device list via HTTP request
        await this.httpClient.getHomes()
        const { httpDeviceList, httpGroupList } = await this.httpClient.getDevices()
        httpDeviceList.forEach(device => deviceList.push(device))
        httpGroupList.forEach(group => groupList.push(group))

        // Set up the WS client, get the user WS host and login
        if (this.config.mode !== 'lan') {
          this.wsClient = new wsClient(this, authData)
          await this.wsClient.login()

          // Refresh the WS connection every 60 minutes
          this.wsRefresh = setInterval(async () => {
            try {
              this.log.debug(this.lang.wsRef)
              await this.wsClient.login()
            } catch (err) {
              this.log.warn('%s %s.', this.lang.wsRefFail, parseError(err))
            }
          }, 3600000)
        }

        // Clear the storage folder and start again when we have access to http devices
        if (this.storageClientLAN) {
          try {
            await this.storageLAN.clear()
          } catch (err) {
            this.log.debugWarn(`${this.lang.storageClearErr} ${parseError(err)}`)
          }
        }
      } else {
        // Warn that HTTP and WS are disabled
        this.log.warn('%s %s.', this.lang.httpDisabled, this.lang.missingCreds)

        // Get the persisted device data if we are in lan only mode
        if (this.config.mode === 'lan' && this.storageClientLAN) {
          try {
            this.log('Obtaining device list from storage.')
            const persistDeviceList = await this.storageLAN.values()
            persistDeviceList.forEach(device => deviceList.push(device))
          } catch (err) {
            this.log.debugWarn(`${this.lang.storageReadErr} ${parseError(err)}`)
          }
        }
      }

      // Set up the LAN client, scan for device and start monitoring
      if (this.config.mode !== 'wan') {
        this.lanClient = new lanClient(this)
        this.lanDevices = await this.lanClient.getHosts()
        await this.lanClient.startMonitor()
      }

      // Initialise each device into HB
      deviceList.forEach(device => this.initialiseDevice(device))
      for (const group of groupList) {
        // Create the format of a device
        group.extra = { uiid: 5000 }
        group.deviceid = group.id
        group.productModel = `Group [${group.uiid}]`
        group.brandName = 'eWeLink'
        group.online = true
        await this.initialiseDevice(group)
      }

      // Check for redundant accessories (in HB but not eWeLink)
      devicesInHB.forEach((accessory) => {
        if (
          !deviceList.some(el => el.deviceid === accessory.context.eweDeviceId)
          && !groupList.some(el => el.id === accessory.context.eweDeviceId)
        ) {
          this.removeAccessory(accessory)
        }
      })

      // Set up the LAN listener for device notifications
      if (this.lanClient) {
        this.lanClient.receiveUpdate(device => this.receiveDeviceUpdate(device))
      }

      // Set up the WS listener for device notifications
      if (this.wsClient) {
        this.wsClient.receiveUpdate(device => this.receiveDeviceUpdate(device))
      }

      // Set up the listener server for the API if the user has this enabled
      if (this.config.apiPort !== 0 && this.config.password) {
        this.apiClient = new apiClient(this, devicesInHB)
        this.apiServer = createServer(async (req, res) => {
          // The 'homepage' shows a html document with info about the API
          if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(this.apiClient.showHome())
            return
          }

          // Request is not for the homepage so action appropriately
          res.writeHead(200, { 'Content-Type': 'application/json' })
          try {
            const response = await this.apiClient.action(req)

            // Actioning the request was successful so respond with a success
            res.end(JSON.stringify({ success: true, response }))
          } catch (err) {
            // An error occurred actioning the request so respond with the error
            res.end(JSON.stringify({ success: false, error: `${err.message}.` }))
          }
        })

        // Start listening on the above created server
        this.apiServer.listen(this.config.apiPort === 1 ? 0 : this.config.apiPort, (err) => {
          if (err) {
            this.log.warn('%s [%s].', this.lang.apiListenErr, err)
          } else {
            this.log('%s [%s].', this.lang.apiListening, this.apiServer.address().port)
          }
        })
      }

      // Setup successful
      this.log('%s. %s', this.lang.complete, this.lang.welcome)
    } catch (err) {
      // Catch any errors during setup
      const eText = parseError(err, [
        this.lang.missingCreds,
        'password error! [10001]',
        'user does not exists [10003]',
      ])
      this.log.warn('***** %s. *****', this.lang.disabling)
      this.log.warn('***** %s. *****', eText)
      this.pluginShutdown()
    }
  }

  pluginShutdown() {
    // A function that is called when the plugin fails to load or Homebridge restarts
    try {
      // Destroy all device handlers
      devicesInHB.forEach((accessory) => {
        if (accessory?.control?.destroy) {
          accessory.control.destroy()
        }
      })

      // Shutdown the listener server if it's running
      if (this.apiServer) {
        this.apiServer.close(() => {
          this.log.debug(this.lang.apiShutdown)
        })
      }

      // Clear pending command queue
      queue.clear()

      // Stop the LAN monitoring
      if (this.lanClient) {
        this.lanClient.closeConnection()
      }

      // Close the WS connection
      if (this.wsClient) {
        clearInterval(this.wsRefresh)
        this.wsClient.closeConnection()
      }
    } catch (err) {
      // No need to show errors at this point
    }
  }

  applyAccessoryLogging(accessory) {
    if (this.isBeta) {
      accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      accessory.logDebug = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logDebugWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
    } else {
      if (this.config.disableDeviceLogging) {
        accessory.log = () => {}
        accessory.logWarn = () => {}
      } else {
        accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
        accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      }
      accessory.logDebug = () => {}
      accessory.logDebugWarn = () => {}
    }
  }

  async initialiseDevice(device) {
    try {
      let accessory
      const uiid = device?.extra?.uiid || 0
      const uuid = this.api.hap.uuid.generate(`${device.deviceid}SWX`)
      device.showAs = this.deviceConf?.[device.deviceid]?.showAs || 'default'

      // Clean up stale services if device category changed (e.g. showAs changed)
      const existingAccessory = devicesInHB.get(uuid)
      if (existingAccessory && existingAccessory.context.showAs && existingAccessory.context.showAs !== device.showAs) {
        const hapServ = this.api.hap.Service
        existingAccessory.services
          .filter(s => !(s instanceof hapServ.AccessoryInformation))
          .forEach(s => existingAccessory.removeService(s))
      }

      // Remove old sub accessories for Accessory Simulations and DUALR3 in motor/meter mode
      if (
        device.showAs !== 'default'
        || (platformConsts.devices.switchMultiPower.includes(uiid)
          && [2, 3].includes(device.params.workMode))
      ) {
        for (let i = 0; i <= 4; i += 1) {
          const uuidsub = this.api.hap.uuid.generate(`${device.deviceid}SW${i}`)
          if (devicesInHB.has(uuidsub)) {
            this.removeAccessory(devicesInHB.get(uuidsub))
          }
        }
      }

      // Set up the correct instance for this particular device
      if (platformConsts.devices.switchMultiPower.includes(uiid) && device.params.workMode === 2) {
        /**
         ***********************
         BLINDS [DUALR3 MOTOR MODE]
         ************************
         */
        // Check the device has been calibrated
        if (device.params.calibState === 0) {
          if (devicesInHB.has(uuid)) {
            this.removeAccessory(devicesInHB.get(uuid))
          }
          this.log.warn('[%s] %s.', device.name, this.lang.dualr3NoCalib)
          this.ignoredDevices.push(device.deviceid)
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceMotor(this, accessory)
        /** */
      } else if (uiid === 211 && device.params.workMode === 2) {
        /**
         ***********************
         BLINDS [T5 MOTOR MODE]
         ************************
         */
        if (!device.params.calibState) {
          if (devicesInHB.has(uuid)) {
            this.removeAccessory(devicesInHB.get(uuid))
          }
          this.log.warn('[%s] %s.', device.name, this.lang.dualr3NoCalib)
          this.ignoredDevices.push(device.deviceid)
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceMotor(this, accessory)
        /** */
      } else if (
        platformConsts.devices.switchMultiPower.includes(uiid)
        && device.params.workMode === 3
      ) {
        /**
         ***********************
         BLINDS [DUALR3 METER MODE]
         ************************
         */
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        this.log.warn('[%s] %s.', device.name, this.lang.dualr3NoMeter)
        this.ignoredDevices.push(device.deviceid)
        return
      } else if (platformConsts.devices.panel.includes(uiid)) {
        /**
         ****
         NSPANEL
         *****
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.devicePanel(this, accessory)
        /** */
      } else if (platformConsts.devices.curtain.includes(uiid)) {
        /**
         **************************
         BLINDS [EWELINK UIID 11 & 67]
         ***************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceCurtain(this, accessory)
        /** */
      } else if (device.showAs === 'blind') {
        /**
         **************************
         BLINDS [ACCESSORY SIMULATION]
         ***************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceBlind(this, accessory)
        /** */
      } else if (device.showAs === 'door') {
        /**
         *************************
         DOORS [ACCESSORY SIMULATION]
         **************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceDoor(this, accessory)
        /** */
      } else if (device.showAs === 'window') {
        /**
         ***************************
         WINDOWS [ACCESSORY SIMULATION]
         ****************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceWindow(this, accessory)
        /** */
      } else if (this.obstructSwitches[device.deviceid]) {
        /**
         ***************************
         OBSTRUCTION DETECTION SWITCHES
         ****************************
         */
        accessory = this.addAccessory(device, `${device.deviceid}SWX`, true)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceGarageOdSwitch(this, accessory, devicesInHB)
        /** */
      } else if (
        Object.values(this.deviceConf).some(el => el.sensorId === device.deviceid)
        && (platformConsts.devices.garageSensors.includes(uiid) || device.showAs === 'sensor')
      ) {
        /**
         ***************************************
         SENSORS [AS GARAGE/LOCK SENSOR SIMULATION]
         ****************************************
         */
        const sim = Object.entries(this.deviceConf).find(
          ([, el]) => el.sensorId === device.deviceid && ['garage', 'lock'].includes(el.showAs),
        )
        const uuidSub = this.api.hap.uuid.generate(`${sim[0]}SWX`)
        if (devicesInHB.has(uuidSub)) {
          const subAccessory = devicesInHB.get(uuidSub)
          let instance
          if (sim[1].hideSensor) {
            // If the sensor exists in Homebridge then remove it as needs to be re-added as hidden
            if (devicesInHB.has(uuid)) {
              this.removeAccessory(devicesInHB.get(uuid))
            }
            instance = deviceTypes.sim.deviceSensorHidden
            accessory = this.addAccessory(device, `${device.deviceid}SWX`, true)
          } else {
            instance = deviceTypes.sim.deviceSensorVisible
            accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
          }
          this.applyAccessoryLogging(accessory)
          accessory.control = new instance(this, accessory, subAccessory)
        } else {
          accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
          this.applyAccessoryLogging(accessory)
          accessory.logWarn(this.lang.sensorNoDevice)
          accessory.control = new deviceTypes.deviceSensorContact(this, accessory)
        }
        /** */
      } else if (device.showAs === 'garage') {
        /**
         **************************************
         GARAGE DOORS [ONE] [ACCESSORY SIMULATION]
         ***************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceGarageOne(this, accessory)
        /** */
      } else if (device.showAs === 'garage_two') {
        /**
         **************************************
         GARAGE DOORS [TWO] [ACCESSORY SIMULATION]
         ***************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceGarageTwo(this, accessory)
        /** */
      } else if (device.showAs === 'garage_four') {
        /**
         ***************************************
         GARAGE DOORS [FOUR] [ACCESSORY SIMULATION]
         ****************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceGarageFour(this, accessory)
        /** */
      } else if (device.showAs === 'garage_eachen') {
        /**
         *************************
         GARAGE DOORS [EACHEN GD-DC5]
         **************************
         */
        const instance = this.deviceConf[device.deviceid]
          && this.deviceConf[device.deviceid].showAsEachen === 'lock'
          ? deviceTypes.sim.deviceLockEachen
          : deviceTypes.sim.deviceGarageEachen
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new instance(this, accessory)
        /** */
      } else if (device.showAs === 'gate') {
        /**
         ******************************************
         GATES (AS GARAGE DOOR) [ACCESSORY SIMULATION]
         *******************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceGateOne(this, accessory, devicesInHB)
        /** */
      } else if (device.showAs === 'lock') {
        /**
         *************************
         LOCKS [ACCESSORY SIMULATION]
         **************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceLockOne(this, accessory)
        /** */
      } else if (device.showAs === 'switch_valve') {
        /**
         ********************************
         SWITCH-VALVE [ACCESSORY SIMULATION]
         *********************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceSwitchValve(this, accessory)
        /** */
      } else if (device.showAs === 'tap') {
        /**
         ******************************
         TAPS [ONE] [ACCESSORY SIMULATION]
         *******************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceTapOne(this, accessory)
        /** */
      } else if (device.showAs === 'tap_two') {
        /**
         ******************************
         TAPS [TWO] [ACCESSORY SIMULATION]
         *******************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceTapTwo(this, accessory)
        /** */
      } else if (device.showAs === 'valve') {
        /**
         ********************************
         VALVES [ONE] [ACCESSORY SIMULATION]
         *********************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceValveOne(this, accessory)
        /** */
      } else if (device.showAs === 'valve_two') {
        /**
         ********************************
         VALVES [TWO] [ACCESSORY SIMULATION]
         *********************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceValveTwo(this, accessory)
        /** */
      } else if (device.showAs === 'valve_four') {
        /**
         *********************************
         VALVES [FOUR] [ACCESSORY SIMULATION]
         **********************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceValveFour(this, accessory)
        /** */
      } else if (device.showAs === 'sensor') {
        /**
         *****************
         SENSORS [SIMULATION]
         ******************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceSensor(this, accessory)
        /** */
      } else if (device.showAs === 'p_button') {
        /**
         *****************************
         PROGRAMMABLE BUTTON [SIMULATION]
         ******************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.devicePButton(this, accessory)
        /** */
      } else if (device.showAs === 'doorbell') {
        /**
         ******************
         DOORBELL [SIMULATION]
         *******************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceDoorbell(this, accessory)
        /** */
      } else if (device.showAs === 'purifier') {
        /**
         *******************
         PURIFIERS [SIMULATION]
         ********************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.devicePurifier(this, accessory)
        /** */
      } else if (device.showAs === 'audio') {
        /**
         *************************
         AUDIO RECEIVERS [SIMULATION]
         **************************
         */
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        accessory = this.addExternalAccessory(device, `${device.deviceid}SWX`, 34)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceTv(this, accessory)
        /** */
      } else if (device.showAs === 'box') {
        /**
         *********************
         SET-TOP BOX [SIMULATION]
         **********************
         */
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        accessory = this.addExternalAccessory(device, `${device.deviceid}SWX`, 35)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceTv(this, accessory)
        /** */
      } else if (device.showAs === 'stick') {
        /**
         *************************
         STREAMING STICK [SIMULATION]
         **************************
         */
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        accessory = this.addExternalAccessory(device, `${device.deviceid}SWX`, 36)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceTv(this, accessory)
        /** */
      } else if (
        device.showAs === 'sensor_leak'
        && platformConsts.devices.sensorContact.includes(uiid)
      ) {
        /**
         ************************************
         SENSORS [LEAK DW2 ACCESSORY SIMULATION]
         *************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceSensorLeak(this, accessory)
        /** */
      } else if (platformConsts.devices.sensorContact.includes(uiid)) {
        /**
         *****************
         SENSORS [SONOFF DW2]
         ******************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSensorContact(this, accessory)
      } else if (platformConsts.devices.fan.includes(uiid)) {
        /**
         FANS
         *
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceFan(this, accessory)
        /**/
      } else if (platformConsts.devices.diffuser.includes(uiid)) {
        /**
         ******
         DIFFUSERS
         *******
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceDiffuser(this, accessory)
        /** */
      } else if (platformConsts.devices.humidifier.includes(uiid)) {
        /**
         ********
         HUMIDIFIERS
         *********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceHumidifier(this, accessory)
        /** */
      } else if (platformConsts.devices.thermostat.includes(uiid)) {
        /**
         ********
         THERMOSTATS
         *********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceThermostat(this, accessory)
        /** */
      } else if (platformConsts.devices.airConditioner.includes(uiid)) {
        /**
         ***************
         AIR CONDITIONERS
         ****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceAirConditioner(this, accessory)
        /** */
      } else if (platformConsts.devices.virtual.includes(uiid)) {
        /**
         ***************
         VIRTUAL DEVICES
         ****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceVirtual(this, accessory)
        /** */
      } else if (
        device.showAs === 'thermostat'
        && platformConsts.devices.sensorAmbient.includes(uiid)
      ) {
        /**
         ***************************************
         THERMOSTATS [TH10/16 ACCESSORY SIMULATION]
         ****************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceThThermostat(this, accessory)
        /** */
      } else if (device.showAs === 'heater' && platformConsts.devices.sensorAmbient.includes(uiid)) {
        /**
         ***********************************
         HEATERS [TH10/16 ACCESSORY SIMULATION]
         ************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceThHeater(this, accessory)
        /** */
      } else if (device.showAs === 'cooler' && platformConsts.devices.sensorAmbient.includes(uiid)) {
        /**
         ***********************************
         COOLERS [TH10/16 ACCESSORY SIMULATION]
         ************************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceThCooler(this, accessory)
        /** */
      } else if (
        device.showAs === 'humidifier'
        && platformConsts.devices.sensorAmbient.includes(uiid)
      ) {
        /**
         ***************************************
         HUMIDIFIERS [TH10/16 ACCESSORY SIMULATION]
         ****************************************
         */
        if (device.params.sensorType === 'DS18B20') {
          if (devicesInHB.has(uuid)) {
            this.removeAccessory(devicesInHB.get(uuid))
          }
          this.log.warn('[%s] %s.', device.name, this.lang.sensorErr)
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceThHumidifier(this, accessory)
        /** */
      } else if (
        device.showAs === 'dehumidifier'
        && platformConsts.devices.sensorAmbient.includes(uiid)
      ) {
        /**
         *****************************************
         DEHUMIDIFIERS [TH10/16 ACCESSORY SIMULATION]
         ******************************************
         */
        if (device.params.sensorType === 'DS18B20') {
          this.log.warn('[%s] %s.', device.name, this.lang.sensorErr)
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceThDehumidifier(this, accessory)
        /** */
      } else if (platformConsts.devices.sensorAmbient.includes(uiid)) {
        /**
         *********************
         SENSOR [AMBIENT-TH10/16]
         **********************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.sensorType = device.params.sensorType
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSensorAmbient(this, accessory)
        /** */
      } else if (platformConsts.devices.sensorTempHumi.includes(uiid)) {
        /**
         ***********************
         SENSOR [AMBIENT-SONOFF SC]
         ************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSensorTempHumi(this, accessory)
        /** */
      } else if (platformConsts.devices.sensorAirQuality.includes(uiid)) {
        /**
         *************************
         SENSOR [AIR QUALITY-SAWF-08P]
         **************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSensorAirQuality(this, accessory)
        /** */
      } else if (device.showAs === 'heater') {
        /**
         *****************
         HEATERS [SIMULATION]
         ******************
         */
        if (!this.deviceConf[device.deviceid].temperatureSource) {
          this.log.warn('[%s] %s.', device.name, this.lang.heaterSimNoSensor)
          if (devicesInHB.has(uuid)) {
            this.removeAccessory(devicesInHB.get(uuid))
          }
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceHeater(this, accessory)
        /** */
      } else if (device.showAs === 'cooler') {
        /**
         *****************
         COOLERS [SIMULATION]
         ******************
         */
        if (!this.deviceConf[device.deviceid].temperatureSource) {
          this.log.warn('[%s] %s.', device.name, this.lang.heaterSimNoSensor)
          if (devicesInHB.has(uuid)) {
            this.removeAccessory(devicesInHB.get(uuid))
          }
          return
        }
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.sim.deviceCooler(this, accessory)
        /** */
      } else if (platformConsts.devices.lightRGB.includes(uiid)) {
        /**
         *********
         LIGHTS [RGB]
         **********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceLightRGB(this, accessory)
        /** */
      } else if (platformConsts.devices.lightCCT.includes(uiid)) {
        /**
         *********
         LIGHTS [CCT]
         **********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceLightCCT(this, accessory)
        /** */
      } else if (platformConsts.devices.lightRGBCCT.includes(uiid)) {
        /**
         ***************
         LIGHTS [RGB & CCT]
         ****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceLightRGBCCT(this, accessory)
        /** */
      } else if (platformConsts.devices.lightDimmer.includes(uiid)) {
        /**
         ************
         LIGHTS [DIMMER]
         *************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = device.showAs === 'fan'
          ? new deviceTypes.sim.deviceLightFan(this, accessory)
          : new deviceTypes.deviceLightDimmer(this, accessory)
        /** */
        /** */
      } else if (
        platformConsts.devices.switchSingle.includes(uiid)
        || platformConsts.devices.switchSinglePower.includes(uiid)
        || platformConsts.devices.switchSCM.includes(uiid)
        || platformConsts.devices.switchSCMPower.includes(uiid)
      ) {
        /**
         ******************************
         SWITCHES/OUTLETS [SINGLE CHANNEL]
         *******************************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        if (device.showAs === 'outlet') {
          accessory.control = this.deviceConf?.[device.deviceid]?.isInched
            ? new deviceTypes.deviceOutletSingleInched(this, accessory)
            : new deviceTypes.deviceOutletSingle(this, accessory)
        } else {
          accessory.control = this.deviceConf?.[device.deviceid]?.isInched
            ? new deviceTypes.deviceSwitchSingleInched(this, accessory)
            : new deviceTypes.deviceSwitchSingle(this, accessory)
        }
        /** */
      } else if (
        platformConsts.devices.switchMulti.includes(uiid)
        || platformConsts.devices.switchMultiPower.includes(uiid)
      ) {
        /**
         *****************************
         SWITCHES/OUTLETS [MULTI CHANNEL]
         ******************************
         */

        // If a single accessory is leftover from a simulation then remove it
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }

        // Loop through the channels of the device
        for (let i = 0; i <= platformConsts.supportedDevices[uiid]; i += 1) {
          let subAccessory
          const uuidsub = this.api.hap.uuid.generate(`${device.deviceid}SW${i}`)

          // Check if the user has chosen to hide any channels for this device
          if (
            this.hideChannels.includes(`${device.deviceid}SW${i}`)
            || (i === 0 && this.deviceConf?.[device.deviceid]?.inchChannels)
          ) {
            // The user has hidden this channel so if it exists then remove it
            if (devicesInHB.has(uuidsub)) {
              this.removeAccessory(devicesInHB.get(uuidsub))
            }

            // If this is the main channel then add it to the array of hidden masters
            if (i === 0) {
              this.hideMasters.push(device.deviceid)
            }

            // Add the sub accessory, but hidden, to Homebridge
            subAccessory = this.addAccessory(device, `${device.deviceid}SW${i}`, true)
          } else {
            // The user has not hidden this channel
            subAccessory = devicesInHB.get(uuidsub) || this.addAccessory(device, `${device.deviceid}SW${i}`)
          }

          // Add context information to the sub accessory
          subAccessory.context.firmware = device.params.fwVersion || plugin.version
          subAccessory.context.reachableWAN = this.wsClient && device.online
          subAccessory.context.reachableLAN = this.lanClient && this.lanDevices.has(device.deviceid) && this.lanDevices.get(device.deviceid).ip
          subAccessory.context.eweBrandName = device.brandName
          subAccessory.context.eweBrandLogo = device.brandLogo
          subAccessory.context.eweShared = device?.sharedBy?.email || false
          subAccessory.context.ip = this.lanClient && subAccessory.context.reachableLAN
            ? this.lanDevices.get(device.deviceid).ip
            : false
          subAccessory.context.macAddress = device.extra?.staMac?.replace(/:+/g, '').replace(/..\B/g, '$&:') || false
          subAccessory.context.lanKey = device.devicekey
          this.applyAccessoryLogging(subAccessory)
          subAccessory.control = device.showAs === 'outlet'
            ? new deviceTypes.deviceOutletMulti(this, subAccessory, devicesInHB)
            : new deviceTypes.deviceSwitchMulti(this, subAccessory, devicesInHB)

          // Mark the online/offline status of certain devices
          if (this.wsClient && subAccessory?.control?.markStatus) {
            subAccessory.control.markStatus(device.online)
          }

          // Update any changes to the sub accessory to the platform
          this.api.updatePlatformAccessories([subAccessory])
          devicesInHB.set(subAccessory.UUID, subAccessory)
          if (i === 0) {
            accessory = subAccessory
          }
        }
        /** */
      } else if (platformConsts.devices.switchMate.includes(uiid)) {
        /**
         *****************
         SWITCH MATE (S-MATE)
         ******************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSwitchMate(this, accessory)
        /** */
      } else if (platformConsts.devices.switchMan.includes(uiid)) {
        /**
         *******
         SWITCH MAN
         ********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceSwitchMan(this, accessory)
        /** */
      } else if (platformConsts.devices.rfBridge.includes(uiid)) {
        /**
         *******************
         RF BRIDGE + SUBDEVICES
         ********************
         */
        let rfChlCounter = 0

        // Make an array of sub devices connected to the RF Bridge
        const rfMap = []
        if (device?.tags?.zyx_info) {
          device.tags.zyx_info.forEach(remote => rfMap.push({
            name: remote.name,
            type: remote.remote_type,
            buttons: Object.assign({}, ...remote.buttonName),
          }))
        }
        accessory = this.addAccessory(device, `${device.deviceid}SW0`, true, { rfMap }, 'rf_pri')
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceRfBridge(this, accessory, devicesInHB)

        // We don't want to add the main bridge as a visible accessory in Homebridge
        this.hideMasters.push(device.deviceid)

        // Flag used for later to remove and re-add the subdevices if user configured
        const resetRF = this.deviceConf?.[device.deviceid]?.resetOnStartup

        // Loop through each sub device connected to the RF Bridge
        rfMap.forEach((subDevice) => {
          const swNumber = rfChlCounter + 1
          let subAccessory
          let subType
          const fullDeviceId = `${device.deviceid}SW${swNumber}`
          const uuidsub = this.api.hap.uuid.generate(fullDeviceId)
          const deviceConf = this.rfSubdevices[fullDeviceId] || {}

          // Check which eWeLink type the connected sub device is
          let subInstance
          switch (subDevice.type) {
            case '1':
            case '2':
            case '3':
            case '4':
              subType = 'button'
              subInstance = deviceTypes.deviceRfButton
              break
            case '5':
              switch (deviceConf.curtainType) {
                case 'blind':
                case 'door':
                case 'window':
                  subType = deviceConf.curtainType
                  subInstance = `simulation/rf-${deviceConf.curtainType}`
                  break
                default:
                  subType = 'curtain'
                  subInstance = deviceTypes.deviceRfButton
                  break
              }
              break
            case '6':
            case '7':
              subType = 'sensor'
              subInstance = deviceTypes.deviceRfSensor
              break
            default: {
              accessory.logWarn(`${this.lang.devNotSupYet}\n[${uiid}-${subDevice.type || '?'}] ${JSON.stringify(device.params)}`)
              return
            }
          }

          // Create an object to save to the sub accessory context
          const subExtraContext = {
            buttons: subDevice.buttons,
            subType,
            swNumber,
            name: subDevice.name,
          }

          // Check if we need to reset the RF devices
          subAccessory = devicesInHB.get(uuidsub)
          if (resetRF && subAccessory) {
            this.removeAccessory(subAccessory)
          }

          // Get the sub accessory if it's new or hasn't been removed above
          subAccessory = devicesInHB.get(uuidsub)
            || this.addAccessory(device, fullDeviceId, false, subExtraContext, 'rf_sub')

          // Add context information to the sub accessory
          subAccessory.context.firmware = device.params.fwVersion || plugin.version
          subAccessory.context.reachableWAN = this.wsClient && device.online
          subAccessory.context.reachableLAN = this.lanClient && this.lanDevices.has(device.deviceid) && this.lanDevices.get(device.deviceid).ip
          subAccessory.context.eweBrandName = device.brandName
          subAccessory.context.eweBrandLogo = device.brandLogo
          subAccessory.context.eweShared = device?.sharedBy?.email || false
          subAccessory.context.ip = this.lanClient && subAccessory.context.reachableLAN
            ? this.lanDevices.get(device.deviceid).ip
            : false
          subAccessory.context.macAddress = device.extra?.staMac?.replace(/:+/g, '').replace(/..\B/g, '$&:') || false
          subAccessory.context.lanKey = device.devicekey
          subAccessory.context.subType = subType

          // Get the instance for this RF device
          this.applyAccessoryLogging(subAccessory)
          subAccessory.control = new subInstance(this, subAccessory)

          // Mark the online/offline status of certain devices
          if (this.wsClient && subAccessory?.control?.markStatus) {
            subAccessory.control.markStatus(device.online)
          }

          // Update any changes to the sub accessory to the platform
          this.api.updatePlatformAccessories([subAccessory])
          devicesInHB.set(subAccessory.UUID, subAccessory)

          // Increment the counter
          rfChlCounter += Object.keys(subDevice.buttons || {}).length
        })

        // Update any changes to the accessory to the platform
        accessory.context.channelCount = rfChlCounter
        /** */
      } else if (platformConsts.devices.zbBridge.includes(uiid)) {
        /**
         **********
         ZIGBEE BRIDGE
         ***********
         */
        this.ignoredDevices.push(device.deviceid)
        return
        /** */
      } else if (platformConsts.devices.zbSwitchStateless.includes(uiid)) {
        /**
         ********************
         ZIGBEE STATELESS SWITCH
         *********************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSwitchStateless(this, accessory)
        /** */
      } else if (platformConsts.devices.zbLightDimmer.includes(uiid)) {
        /**
         ***************
         ZB LIGHTS [DIMMER]
         ****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceLightDimmer(this, accessory)
        /** */
      } else if (platformConsts.devices.zbLightCCT.includes(uiid)) {
        /**
         ************
         ZB LIGHTS [CCT]
         *************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceLightCCT(this, accessory)
        /** */
      } else if (platformConsts.devices.zbLightRGBCCT.includes(uiid)) {
        /**
         ****************
         ZB LIGHTS [RGB+CCT]
         *****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceLightRGBCCT(this, accessory)
        /** */
      } else if (platformConsts.devices.zbMotor.includes(uiid)) {
        /**
         *****
         ZB MOTOR
         ******
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceMotor(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorAmbient.includes(uiid)) {
        /**
         ****************
         ZB SENSOR [AMBIENT]
         *****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorAmbient(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorMotion.includes(uiid)) {
        /**
         ***************
         ZB SENSOR [MOTION]
         ****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorMotion(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorOccupancy.includes(uiid)) {
        /**
         ******************
         ZB SENSOR [OCCUPANCY]
         *******************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorOccupancy(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorContact.includes(uiid)) {
        /**
         ****************
         ZB SENSOR [CONTACT]
         *****************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorContact(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorWater.includes(uiid)) {
        /**
         *************
         ZB SENSOR [LEAK]
         **************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorLeak(this, accessory)
        /** */
      } else if (platformConsts.devices.zbSensorSmoke.includes(uiid)) {
        /**
         **************
         ZB SENSOR [SMOKE]
         ***************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceSensorSmoke(this, accessory)
        /** */
      } else if (platformConsts.devices.zbThermostat.includes(uiid)) {
        /**
         *******************
         ZB SENSOR [THERMOSTAT]
         ********************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceThermostat(this, accessory)
        /** */
      } else if (platformConsts.devices.zbWaterValve.includes(uiid)) {
        /**
         *******************
         ZB WATER VALVE
         ********************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.zb.deviceZigbeeWaterValve(this, accessory)
        /** */
      } else if (platformConsts.devices.group.includes(uiid)) {
        /**
         ***********
         EWELINK GROUPS
         ************
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        accessory.context.groupUIID = device.uiid
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceGroup(this, accessory)
        /** */
      } else if (platformConsts.devices.camera.includes(uiid)) {
        /**
         ***********
         SONOFF CAMERAS
         ************
         */
        this.log('[%s] %s.', device.name, this.lang.sonoffCamera)
        this.ignoredDevices.push(device.deviceid)
        return
        /** */
      } else if (platformConsts.devices.template.includes(uiid)) {
        /**
         *********
         TEMPLATE DEV
         **********
         */
        accessory = devicesInHB.get(uuid) || this.addAccessory(device, `${device.deviceid}SWX`)
        this.applyAccessoryLogging(accessory)
        accessory.control = new deviceTypes.deviceTemplate(this, accessory)
        /** */
      } else if (platformConsts.devices.cannotSupport.includes(uiid)) {
        /**
         *****************************
         DEVICES THAT CANNOT BE SUPPORTED
         ******************************
         */
        this.log('[%s] %s.', device.name, this.lang.devNotSup)
        this.ignoredDevices.push(device.deviceid)
        return
        /** */
      } else {
        /**
         ********************
         DEVICES PENDING SUPPORT
         *********************
         */
        this.log.warn(
          '[%s] %s:\n[%s] %s.',
          device.name,
          this.lang.devNotSupYet,
          uiid,
          JSON.stringify(device.params),
        )
        return
        /** */
      }

      // Update the reachability values (via WS and LAN)
      accessory.context.firmware = device.params.fwVersion || plugin.version
      accessory.context.reachableWAN = this.wsClient && device.online
      accessory.context.reachableLAN = this.lanClient && this.lanDevices.has(device.deviceid) && this.lanDevices.get(device.deviceid).ip
      accessory.context.eweBrandName = device.brandName
      accessory.context.eweBrandLogo = device.brandLogo
      accessory.context.eweShared = device?.sharedBy?.email || false
      accessory.context.ip = this.lanClient && accessory.context.reachableLAN ? this.lanDevices.get(device.deviceid).ip : false
      accessory.context.macAddress = device.extra?.staMac?.replace(/:+/g, '').replace(/..\B/g, '$&:') || false
      accessory.context.lanKey = device.devicekey
      accessory.context.showAs = device.showAs

      // Add the uuid and lanKey to the this.lanClient map
      if (this.lanClient) {
        this.lanClient.addDeviceDetailsToMap(device.deviceid, accessory.context)
      }

      // Helpful logging for each device
      const str = accessory.context.reachableLAN
        ? `${this.lang.foundWithIP} [${this.lanDevices.get(device.deviceid).ip}]`
        : this.lang.lanUnsupported

      // Check to see if the discovered IP is different from any manually configured IP
      if (
        accessory.context.reachableLAN
        && this.ipOverride[device.deviceid]
        && this.ipOverride[device.deviceid] !== this.lanDevices.get(device.deviceid).ip
      ) {
        accessory.logWarn(`${this.lang.lanIPDifferent} [${this.lanDevices.get(device.deviceid).ip}]`)
      }

      // Check to see if it's a shared device being used with the cloud
      if (!accessory.context.reachableLAN && accessory.context.eweShared) {
        accessory.logWarn(this.lang.shareWarn)
      }

      // Check to see if the device has initially been reported offline
      if (this.wsClient && !accessory.context.reachableWAN && !accessory.context.reachableLAN) {
        accessory.logWarn(`${this.lang.repOffline} ${this.lang.viaWS}`)
      }

      // Update accessory characteristics with the latest values
      if (this.wsClient && accessory?.control?.externalUpdate) {
        accessory.control.externalUpdate(device.params)

        // Mark the online/offline status of certain devices
        if (accessory.control.markStatus) {
          accessory.control.markStatus(device.online)
        }
      }

      // Update any changes to the device into our devicesInHB map
      this.api.updatePlatformAccessories([accessory])
      devicesInHB.set(accessory.UUID, accessory)
      if (uiid === 5000) {
        this.log(
          '[%s] %s [%s] [%s].',
          accessory.displayName,
          this.lang.devInitGroup,
          device.deviceid,
          uiid,
        )
      } else {
        this.log(
          '[%s] %s %s [%s:%s].',
          accessory.displayName,
          this.lang.devInit,
          str,
          uiid,
          device.productModel,
        )
      }

      // Store the device in the persist file
      if (this.storageClientLAN && platformConsts.devices.lan.includes(uiid)) {
        try {
          await this.storageLAN.setItem(device.deviceid, device)
        } catch (err) {
          accessory.logDebugWarn(`${this.lang.storageWriteErr} ${parseError(err)}`)
        }
      }
    } catch (err) {
      // Catch any errors during initialisation
      this.log.warn('[%s] %s %s.', device.name, this.lang.devNotInit, parseError(err))
    }
  }

  addAccessory(device, hbDeviceId, hidden = false, extraContext = {}, type = '') {
    // Add an accessory to Homebridge
    let newDeviceName = 'Unknown'
    try {
      // Get the switchNumber which can be {X, 0, 1, 2, 3, 4, ...}
      const switchNumber = hbDeviceId.split('SW')[1].toString()
      const channelCount = type === 'rf_pri'
        ? Object.keys((device?.tags?.zyx_info) || []).length
        : platformConsts.supportedDevices[device.extra.uiid]

      // Set up the device name which can depend on the accessory type
      if (type === 'rf_sub') {
        // RF accessories have their name stored in the context
        newDeviceName = extraContext.name
      } else {
        // Other accessories store the name initially as the device name
        newDeviceName = device.name

        // Check if it's a channel of a multi-channel device
        if (['1', '2', '3', '4'].includes(switchNumber)) {
          // Try and obtain the eWeLink channel name
          if (device?.tags?.ck_channel_name?.[Number.parseInt(switchNumber, 10) - 1]) {
            // Found the eWeLink channel name
            newDeviceName = device.tags.ck_channel_name[Number.parseInt(switchNumber, 10) - 1]
          } else {
            // Didn't find the eWeLink channel name use generic SW channel
            newDeviceName += ` SW${switchNumber}`
          }
        }
      }

      // Add the new accessory to Homebridge
      const accessory = new this.api.platformAccessory(
        newDeviceName,
        this.api.hap.uuid.generate(hbDeviceId),
      )

      // If it isn't a hidden device then set the accessory characteristics
      if (!hidden) {
        accessory
          .getService(this.api.hap.Service.AccessoryInformation)
          .setCharacteristic(this.api.hap.Characteristic.Name, newDeviceName)
          .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, newDeviceName)
          .setCharacteristic(this.api.hap.Characteristic.SerialNumber, hbDeviceId)
          .setCharacteristic(this.api.hap.Characteristic.Manufacturer, device.brandName)
          .setCharacteristic(
            this.api.hap.Characteristic.Model,
            `${device.productModel} (${device.extra.model})`,
          )
          .setCharacteristic(
            this.api.hap.Characteristic.FirmwareRevision,
            device.params.fwVersion || plugin.version,
          )
          .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      }

      // Add helpful context values to the accessory
      accessory.context = {

        hbDeviceId,
        eweDeviceId: device.deviceid,
        eweUIID: device.extra.uiid,
        eweModel: device.productModel,
        eweApiKey: device.apikey,
        switchNumber,
        channelCount,
        hidden,
        ...extraContext,
      }

      // Register the accessory if it hasn't been hidden by the user
      if (!hidden) {
        this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
        this.log('[%s] %s.', newDeviceName, this.lang.devAdd)
      }

      // Return the new accessory
      this.configureAccessory(accessory)
      return accessory
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', newDeviceName, this.lang.devNotAdd, parseError(err))
      return false
    }
  }

  addExternalAccessory(device, hbDeviceId, category) {
    try {
      // Add the new accessory to Homebridge
      const accessory = new this.api.platformAccessory(
        device.name,
        this.api.hap.uuid.generate(hbDeviceId),
        category,
      )

      // Set the accessory characteristics
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Name, device.name)
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.name)
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, hbDeviceId)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, device.brandName)
        .setCharacteristic(
          this.api.hap.Characteristic.Model,
          `${device.productModel} (${device.extra.model})`,
        )
        .setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          device.params.fwVersion || plugin.version,
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)

      // Add helpful context values to the accessory
      accessory.context = {

        hbDeviceId,
        eweDeviceId: device.deviceid,
        eweUIID: device.extra.uiid,
        eweModel: device.productModel,
        eweApiKey: device.apikey,
        switchNumber: hbDeviceId.split('SW')[1].toString(),
        channelCount: platformConsts.supportedDevices[device.extra.uiid],
        hidden: false,
      }

      // Register the accessory
      this.api.publishExternalAccessories(plugin.name, [accessory])
      this.log('[%s] %s.', device.name, this.lang.devAdd)

      // Return the new accessory
      this.configureAccessory(accessory)
      return accessory
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', device.name, this.lang.devNotAdd, parseError(err))
      return false
    }
  }

  configureAccessory(accessory) {
    // Set the correct firmware version if we can
    if (this.api && accessory.context.firmware) {
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .updateCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          accessory.context.firmware,
        )
    }

    // Add the configured accessory to our global map
    devicesInHB.set(accessory.UUID, accessory)
  }

  removeAccessory(accessory) {
    try {
      // Remove an accessory from Homebridge
      if (!accessory.context.hidden) {
        this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory])
      }
      devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, this.lang.devRemove)
    } catch (err) {
      // Catch any errors during remove
      this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotRemove, parseError(err))
    }
  }

  async sendDeviceUpdate(accessory, params) {
    // Log the update being sent
    accessory.logDebug(`${this.lang.updSend} ${JSON.stringify(params)}`)

    // Set up the payload to send via LAN/WS
    const payload = {
      apikey: accessory.context.eweApiKey,
      deviceid: accessory.context.eweDeviceId,
      params,
    }

    // Try LAN first (bypass queue for instant local response)
    let lanResult
    if (this.lanClient && platformConsts.devices.lan.includes(accessory.context.eweUIID)) {
      lanResult = await this.lanClient.sendUpdate(payload)
      if (lanResult === 'ok') {
        return true
      }
    }

    // Fall back to cloud via queue
    return queue.add(async () => {
      if (this.wsClient) {
        const reason = lanResult || (this.lanClient ? this.lang.lanNotSup : this.lang.lanDisabled)
        accessory.logDebug(`${this.lang.revertWS} ${reason}`)
        if (accessory.context.reachableWAN) {
          return this.wsClient.sendUpdate(payload)
        }
        throw new Error(this.lang.unreachable)
      } else {
        const eText = lanResult ? `${this.lang.unreachable} [${lanResult}]` : this.lang.lanDisabled
        throw new Error(eText)
      }
    })
  }

  async sendGroupUpdate(accessory, params) {
    // Add to a queue so multiple updates are at least 500ms apart
    return queue.add(async () => {
      // Log the update being sent
      accessory.logDebug(`${this.lang.updSend} ${JSON.stringify(params)}`)

      // Send the request via HTTP
      await this.httpClient.updateGroup(accessory.context.eweDeviceId, params)
    })
  }

  async receiveDeviceUpdate(device) {
    const deviceId = device.deviceid
    let reachableChange = false

    // Find our accessory for which the updates relate to
    const uuid1 = this.api.hap.uuid.generate(`${deviceId}SWX`)
    const uuid2 = this.api.hap.uuid.generate(`${deviceId}SW0`)
    const accessory = devicesInHB.get(uuid1) || devicesInHB.get(uuid2)
    if (!accessory) {
      return
    }
    accessory.logDebug(`${this.lang.updRec} ${JSON.stringify(device.params)}`)
    if (device.params.updateSource === 'WS') {
      // The update is from WS so update the WS online/offline status
      if (device.params.online !== accessory.context.reachableWAN) {
        accessory.context.reachableWAN = device.params.online
        this.api.updatePlatformAccessories([accessory])
        devicesInHB.set(accessory.UUID, accessory)

        // Flag this true to update the sub accessories later
        reachableChange = true

        // Log the new reachability of the device
        if (accessory.context.reachableWAN) {
          accessory.logDebug(`${this.lang.repOnline} ${this.lang.viaWS}`)
        } else {
          accessory.logDebugWarn(`${this.lang.repOffline} ${this.lang.viaWS}`)
        }

        // Mark the online/offline status of certain devices
        if (accessory?.control?.markStatus) {
          accessory.control.markStatus(device.params.online)
        }

        // Try and request an update through WS if the device has come back online
        if (accessory.context.reachableWAN && this.wsClient) {
          try {
            await this.wsClient.requestUpdate(accessory)
          } catch (err) {
            // Suppress any errors here
          }
        }
      }
    }
    if (device.params.updateSource === 'LAN') {
      // The update is from LAN so it must be online
      if (!accessory.context.reachableLAN) {
        accessory.context.reachableLAN = true

        // Flag this true to update the sub accessories later
        reachableChange = true

        // Log the new reachability of the device
        accessory.log(`${this.lang.repOnline} ${this.lang.viaLAN}`)

        // Try and request an update through WS if the device has come back online
        if (accessory.context.reachableWAN && this.wsClient) {
          try {
            await this.wsClient.requestUpdate(accessory)
          } catch (err) {
            // Suppress any errors here
          }
        }
      }

      // Check to see if the IP of the device has changed
      if (device.params.ip && device.params.ip !== accessory.context.ip) {
        accessory.context.ip = device.params.ip

        // Flag this true to update the sub accessories later
        reachableChange = true

        // Log the new ip of the device
        accessory.log(`${this.lang.newIP} [${device.params.ip}]`)
      }

      // Update the accessory context if the device is back online or the IP changed
      if (reachableChange) {
        this.api.updatePlatformAccessories([accessory])
        devicesInHB.set(accessory.UUID, accessory)
      }
    }

    // Update this new online/offline status for all switches of multichannel devices
    if (reachableChange && accessory.context.hbDeviceId.slice(-1) !== 'X') {
      // Loop through to see which channels are in HB
      for (let i = 1; i <= accessory.context.channelCount; i += 1) {
        const uuid = this.api.hap.uuid.generate(`${deviceId}SW${i}`)
        if (devicesInHB.has(uuid)) {
          // Find the sub accessory
          const subAccessory = devicesInHB.get(uuid)

          // Update the WAN status
          subAccessory.context.reachableWAN = device.params.online
          if (device.params.updateSource === 'WS' && subAccessory?.control?.markStatus) {
            subAccessory.control.markStatus(device.params.online)
          }

          // Update the LAN status
          if (device.params.updateSource === 'LAN') {
            subAccessory.context.reachableLAN = true
            if (device.params.ip) {
              subAccessory.context.ip = device.params.ip
            }
          }

          // Save the sub accessory updates to the platform
          this.api.updatePlatformAccessories([subAccessory])
          devicesInHB.set(subAccessory.UUID, subAccessory)
        }
      }
    }
    try {
      // Update the accessory with the new data
      if (accessory?.control?.externalUpdate) {
        accessory.control.externalUpdate(device.params)
      }
    } catch (err) {
      this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotRf, parseError(err))
    }
  }

  async deviceUpdateError(accessory, err, requestRefresh) {
    // Log the error
    this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotUpd, parseError(err))

    // We only request a device refresh on failed internal updates
    if (requestRefresh && accessory.context.reachableWAN && this.wsClient) {
      try {
        await this.wsClient.requestUpdate(accessory)
      } catch (error) {
        // Suppress any errors at this point
      }
    }
  }
}
