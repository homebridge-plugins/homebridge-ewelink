import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import events from 'node:events'

import axios from 'axios'

import dnsSd from '../node-dns-sd/lib/dns-sd.js'
import platformConsts from '../utils/constants.js'
import { hasProperty, parseError, sleep } from '../utils/functions.js'

const emitter = new events()

export default class {
  constructor(platform) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.ipOverride = platform.ipOverride
    this.lang = platform.lang
    this.log = platform.log
    this.mode = platform.config.mode

    // Set up other variables and libraries needed by this class
    this.deviceMap = new Map()
  }

  async getHosts() {
    // Create a template map with our device list from the HTTP client
    Object.entries(this.ipOverride).forEach((entry) => {
      const [deviceId, ip] = entry
      // Add this device into the map with its user configured IP
      this.deviceMap.set(deviceId, {
        ip,
        ipOverride: true,
      })
    })

    // Perform an initial discovery of devices on the local network
    if (this.debug) {
      this.log('%s.', this.lang.lanStarting)
    }
    const res = await dnsSd.discover({ name: '_ewelink._tcp.local' })
    if (this.debug) {
      this.log('%s.', this.lang.lanStarted)
    }

    // Update the device map for each device found on the local network
    res.forEach((device) => {
      // Obtain the ewelink deviceId and check to see it is in our map
      const deviceId = device.fqdn.replace('._ewelink._tcp.local', '').replace('eWeLink_', '')

      // Do not override any overridden IPs
      if (!this.deviceMap.has(deviceId)) {
        this.deviceMap.set(deviceId, {
          ip: device.address,
          ipOverride: false,
        })
      }
    })
    return this.deviceMap
  }

  async startMonitor() {
    // Function to parse DNS packets picked up by node-dns-sd
    dnsSd.ondata = (packet) => {
      try {
        if (!packet.answers) {
          return
        }
        packet.answers
          .filter(value => value.name.includes('_ewelink._tcp.local'))
          .filter(value => value.type === 'TXT')
          .filter(value => this.deviceMap.has(value.rdata.id))
          .filter(value => this.deviceMap.get(value.rdata.id).lanKey)
          .forEach((value) => {
            const { rdata } = value

            // Check the packet relates to a device in our map
            const deviceInfo = this.deviceMap.get(rdata.id)

            // Skip the update if it's a duplicate
            if (deviceInfo.lastIV === rdata.iv) {
              return
            }
            deviceInfo.lastIV = rdata.iv

            // Obtain the packet information
            const data = rdata.data1 + (rdata.data2 || '') + (rdata.data3 || '') + (rdata.data4 || '')
            const key = createHash('md5')
              .update(Buffer.from(deviceInfo.lanKey, 'utf8'))
              .digest()
            const dText = createDecipheriv(
              'aes-128-cbc',
              key,
              Buffer.from(rdata.iv, 'base64'),
            )
            const pText = Buffer.concat([
              dText.update(Buffer.from(data, 'base64')),
              dText.final(),
            ]).toString('utf8')

            // Check to see if the IP address of the device has changed
            if (packet.address !== deviceInfo.ip) {
              deviceInfo.ip = deviceInfo.ipOverride ? deviceInfo.ip : packet.address
            }

            this.deviceMap.set(rdata.id, deviceInfo)

            // Parse the deconstructed information from the packet
            let params
            try {
              // Fix RF Bridge malformed JSON and strip trailing garbage bytes
              // eslint-disable-next-line no-control-regex
              const cleanText = pText.replace(/"\s*=\s*"/g, '":"').replace(/[\x00-\x1F]+$/g, '')
              params = JSON.parse(cleanText)
            } catch (err) {
              this.log.warn(
                '[%s] %s %s:\n%s',
                rdata.id,
                this.lang.cantReadPacket,
                err.message,
                pText,
              )
              return
            }

            // Remove any params we don't need
            Object.keys(params).forEach((param) => {
              if (!platformConsts.paramsToKeep.includes(param.replace(/\d/g, ''))) {
                delete params[param]
              }
            })

            // If any params are left then generate the template to be emitted
            if (Object.keys(params).length > 0) {
              if (packet.address !== deviceInfo.ip) {
                params.ip = packet.address
              }
              params.online = true
              params.updateSource = 'LAN'
              const returnTemplate = {
                deviceid: rdata.id,
                params,
              }
              emitter.emit('update', returnTemplate)
            }
          })
      } catch (err) {
        this.log.warn('%s %s.', this.lang.cantParsePacket, parseError(err))
      }
    }

    // Start the DNS packet monitoring
    await dnsSd.startMonitoring()
    this.log('%s.', this.lang.lanMonitor)

    // Log LAN discovery summary after 10 seconds
    setTimeout(() => {
      const total = this.deviceMap.size
      const withIp = [...this.deviceMap.values()].filter(d => d.ip).length
      this.log('LAN discovery: %s/%s devices found locally.', withIp, total)
    }, 10000)
  }

  async sendUpdate(json, retries = 0) {
    try {
      // Check this device exists in the map
      if (!this.deviceMap.has(json.deviceid)) {
        throw new Error(this.lang.devNotReachLAN)
      }

      const deviceInfo = this.deviceMap.get(json.deviceid)

      // Check we have an IP address for the device
      if (!deviceInfo.ip) {
        throw new Error(this.lang.devNotReachLAN)
      }

      // Check we have the device lan key
      if (!deviceInfo.lanKey || !deviceInfo.uiid || !deviceInfo.productModel) {
        throw new Error(this.lang.devNoAPIKey)
      }

      const params = {}
      let suffix

      // Check the params to see which suffix and params we need
      if (json.params.brightness) {
        params.switch = 'on'
        params.brightness = json.params.brightness
        params.mode = 0
        suffix = 'dimmable'
      } else if (json.params.switches) {
        const specialModels = ['iFan03', 'iFan', 'iFan04']
        if (deviceInfo.uiid === 34 && specialModels.includes(deviceInfo.productModel)) {
          // Special format for some iFan models
          if (json.params.switches[0].outlet === 0) {
            // Turn on/off the light for the iFan
            params.light = json.params.switches[0].switch
            suffix = 'light'
          } else {
            // Change the state or speed of the iFan
            if (json.params.switches[0].switch === 'off') {
              params.fan = 'off'
            } else {
              params.fan = 'on'
              switch (json.params.switches[1].switch + json.params.switches[2].switch) {
                case 'offoff':
                  params.speed = 1
                  break
                case 'onoff':
                  params.speed = 2
                  break
                case 'offon':
                  params.speed = 3
                  break
                default:
                  // Should never happen
                  return 'ok'
              }
            }
            suffix = 'fan'
          }
        } else {
          params.switches = json.params.switches
          if (json.params.operSide !== undefined) {
            params.operSide = json.params.operSide
          }
          suffix = 'switches'
        }
      } else if (json.params.switch) {
        params.switch = json.params.switch
        if (deviceInfo.uiid === 15) {
          // TH10/16 only supports LAN in normal mode
          if (json.params.deviceType === 'normal') {
            // Extra params for the TH10/16
            params.mainSwitch = json.params.mainSwitch
            params.deviceType = json.params.deviceType
          } else {
            throw new Error(this.lang.devNotConfLAN)
          }
        }
        suffix = 'switch'
      } else if (
        hasProperty(json.params, 'location')
        && platformConsts.devices.switchMultiPower.includes(deviceInfo.uiid)
      ) {
        // Use hasProperty has location can be INT 0
        params.location = json.params.location
        suffix = 'location'
      } else if (hasProperty(json.params, 'sledOnline')) {
        params.sledOnline = json.params.sledOnline ? 'on' : 'off'
        suffix = 'switch'
      } else if (json.params.uiActive && deviceInfo.uiid === 32) {
        params.uiActive = json.params.uiActive
        suffix = 'monitor'
      } else if (json.params.uiActive && [126, 165].includes(deviceInfo.uiid)) {
        // DualR3 uses statistics endpoint in LAN mode
        suffix = 'statistics'
      } else if (json.params.cmd) {
        params.cmd = 'transmit'
        params.rfChl = json.params.rfChl
        suffix = 'transmit'
      } else if (hasProperty(json.params, 'ltype')) {
        params.ltype = json.params.ltype
        if (hasProperty(json.params, 'white')) {
          params.white = json.params.white
        } else {
          params.color = json.params.color
        }
        suffix = 'dimmable'
      } else {
        throw new Error(this.lang.devNotConfLAN)
      }

      // Generate the HTTP request
      const key = createHash('md5')
        .update(Buffer.from(deviceInfo.lanKey, 'utf8'))
        .digest()
      const iv = randomBytes(16)
      const enc = createCipheriv('aes-128-cbc', key, iv)
      const data = {
        data: Buffer.concat([enc.update(JSON.stringify(params)), enc.final()]).toString('base64'),
        deviceid: json.deviceid,
        encrypt: true,
        iv: iv.toString('base64'),
        selfApikey: '123',
        sequence: Date.now().toString(),
      }

      // Send the HTTP request
      const res = await axios({
        method: 'post',
        url: `http://${deviceInfo.ip}:8081/zeroconf/${suffix}`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        data,
        timeout: this.mode === 'lan' ? 9000 : 3000,
      })

      // Check for any errors in the response
      if (!res.data || res.data.error !== 0) {
        const error = res?.data?.error || this.lang.lanErr
        throw new Error(error)
      }

      // This ok is needed by the plugin
      return 'ok'
    } catch (err) {
      // Retry on ECONNRESET (device web server is single-threaded)
      if (err.code === 'ECONNRESET' && retries < 10) {
        await sleep(100)
        return this.sendUpdate(json, retries + 1)
      }
      return parseError(err)
    }
  }

  receiveUpdate(f) {
    emitter.addListener('update', f)
  }

  addDeviceDetailsToMap(deviceId, context) {
    const entry = this.deviceMap.get(deviceId) || { ip: this.ipOverride[deviceId] }
    entry.lanKey = context.lanKey
    entry.uiid = context.eweUIID
    entry.productModel = context.eweModel
    this.deviceMap.set(deviceId, entry)
  }

  async closeConnection() {
    // This is called when Homebridge is shutdown
    await dnsSd.stopMonitoring()
    if (this.debug) {
      this.log('%s.', this.lang.stoppedLAN)
    }
  }
}
