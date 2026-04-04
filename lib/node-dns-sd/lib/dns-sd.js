/* ------------------------------------------------------------------
* node-dns-sd - dns-sd.js
*
* Copyright (c) 2018 - 2020, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2020-09-30
* ---------------------------------------------------------------- */

import mDgram from 'node:dgram'
import mOs from 'node:os'

import mDnsSdComposer from './dns-sd-composer.js'
import mDnsSdParser from './dns-sd-parser.js'

const appleTvRegex = /Apple TV/
const deviceInfoRegex = /_device-info/
const googlecastRegex = /_googlecast/
const philipsHueRegex = /Philips hue/
const canonRegex = /Canon/
const appleTvDashRegex = /Apple-TV/
const iPadRegex = /iPad/
const spaceRegex = / /
const leadingUnderscoreRegex = /^_/
const typeValidRegex = /^[a-z0-9]{1,10}$/i
const keyValidRegex = /^(?:address|fqdn)$/
const ipv4Regex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/

/* ------------------------------------------------------------------
* Constructor: DnsSd()
* ---------------------------------------------------------------- */
function DnsSd() {
  // Public
  this.ondata = () => { }

  // Private
  this._MULTICAST_ADDR = '224.0.0.251'
  this._UDP_PORT = 5353
  this._DISCOVERY_WAIT_DEFAULT = 3 // sec

  this._udp = null
  this._source_address_list = []
  this._discovered_devices = {}
  this._is_discovering = false
  this._is_monitoring = false
  this._is_listening = false
  this._onreceive = () => { }
}

/* ------------------------------------------------------------------
* Method: discover(params)
* - params   | Object    | Required |
*   - name   | String or | Required | Servcie name.(e.g., "_googlecast._tcp.local")
*            | Array     |          |
*   - type   | String    | Optional | Query Type (e.g., "PTR"). The default value is "*".
*   - key    | String    | Optional | "address" (default) or "fqdn".
*            |           |          | - "address": IP address based discovery
*            |           |          | - "fqdn": FQDN (service) based discovery
*   - wait   | Integer   | Optional | Duration of monitoring. The default value is 3 (sec).
*   - quick  | Boolean   | Optional | If `true`, this method returns immediately after
*            |           |          | a device was found ignoring the value of the `wait`.
*            |           |          | The default value is `false`.
*   - filter | String or | Optional | If specified as a string, this method discovers only
*            | Function  |          | devices which the string is found in the `fqdn`,
*            |           |          | `address`, `modelName` or `familyName`.
*            |           |          | If specified as a function, this method discovers
*            |           |          | only devices for which the function returns `true`.
* ---------------------------------------------------------------- */
DnsSd.prototype.discover = function (params) {
  const promise = new Promise((resolve, reject) => {
    if (this._is_discovering === true) {
      reject(new Error('The discovery process is running.'))
      return
    }
    // Check the parameters
    const res = this._checkDiscoveryParameters(params)
    if (res.error) {
      reject(res.error)
      return
    }
    const device_list = []
    this._startListening().then(() => this._startDiscovery(res.params)).then(() => {
      for (const addr in this._discovered_devices) {
        const device = this._discovered_devices[addr]
        device_list.push(device)
      }
      this._stopDiscovery().then(() => {
        resolve(device_list)
      })
    }).catch((error) => {
      this._stopDiscovery().then(() => {
        reject(error)
      })
    })
  })
  return promise
}

DnsSd.prototype._createDeviceObject = function (packet) {
  const o = {}

  const trecs = {};
  ['answers', 'authorities', 'additionals'].forEach((k) => {
    packet[k].forEach((r) => {
      const { type } = r
      if (!trecs[type]) {
        trecs[type] = []
      }
      trecs[type].push(r)
    })
  })

  o.address = null
  if (trecs.A) {
    o.address = trecs.A[0].rdata
  }
  if (!o.address) {
    o.address = packet.address
  }

  o.fqdn = null
  if (trecs.PTR) {
    const rec = trecs.PTR[0]
    o.fqdn = rec.rdata
  }

  o.modelName = null
  o.familyName = null
  if (trecs.TXT && trecs.TXT[0] && trecs.TXT[0].rdata) {
    const r = trecs.TXT[0]
    const d = r.rdata || {}
    const name = r.name || ''
    if (appleTvRegex.test(name)) {
      o.modelName = 'Apple TV'
      if (trecs.TXT) {
        for (let i = 0; i < trecs.TXT.length; i += 1) {
          const r = trecs.TXT[i]
          if (deviceInfoRegex.test(r.name) && r.rdata && r.rdata.model) {
            o.modelName = `Apple TV ${r.rdata.model}`
            break
          }
        }
      }
    } else if (googlecastRegex.test(name)) {
      o.modelName = d.md || null
      o.familyName = d.fn || null
    } else if (philipsHueRegex.test(name)) {
      o.modelName = 'Philips hue'
      if (d.md) {
        o.modelName += ` ${d.md}`
      }
    } else if (canonRegex.test(name)) {
      o.modelName = d.ty || null
    }
  }
  if (!o.modelName) {
    if (trecs.A && trecs.A[0]) {
      const r = trecs.A[0]
      const { name } = r
      if (appleTvDashRegex.test(name)) {
        o.modelName = 'Apple TV'
      } else if (iPadRegex.test(name)) {
        o.modelName = 'iPad'
      }
    }
  }

  if (!o.modelName) {
    if (o.fqdn) {
      const hostname = (o.fqdn.split('.')).shift()
      if (hostname && spaceRegex.test(hostname)) {
        o.modelName = hostname
      }
    }
  }

  o.service = null
  if (trecs.SRV) {
    const rec = trecs.SRV[0]
    const name_parts = rec.name.split('.')
    name_parts.reverse()
    o.service = {
      port: rec.rdata.port,
      protocol: name_parts[1].replace(leadingUnderscoreRegex, ''),
      type: name_parts[2].replace(leadingUnderscoreRegex, ''),
    }
  }

  o.packet = packet
  return o
}

DnsSd.prototype._checkDiscoveryParameters = function (params) {
  const p = {}
  if (params) {
    if (typeof (params) !== 'object') {
      return { error: new Error('The argument `params` is invalid.') }
    }
  } else {
    return { error: new Error('The argument `params` is required.') }
  }

  if ('name' in params) {
    const v = params.name
    if (typeof (v) === 'string') {
      if (v === '') {
        return { error: new Error('The `name` must be an non-empty string.') }
      }
      p.name = [v]
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        return { error: new Error('The `name` must be a non-empty array.') }
      }
      if (v.length > 255) {
        return { error: new Error('The `name` can include up to 255 elements.') }
      }
      let err = null
      const list = []
      for (let i = 0; i < v.length; i += 1) {
        if (typeof (v[i]) === 'string' && v[i] !== '') {
          list.push(v[i])
        } else {
          err = new Error('The `name` must be an Array object including non-empty strings.')
          break
        }
      }
      if (err) {
        return { error: err }
      }
      p.name = list
    } else {
      return { error: new Error('The `name` must be a string or an Array object.') }
    }
  } else {
    return { error: new Error('The `name` is required.') }
  }

  if ('type' in params) {
    const v = params.type
    if (typeof (v) !== 'string' || !(typeValidRegex.test(v) || v === '*')) {
      return { error: new Error('The `type` is invalid.') }
    }
    p.type = v.toUpperCase()
  }

  if ('key' in params) {
    let v = params.key
    if (typeof (v) !== 'string' || !keyValidRegex.test(v)) {
      return { error: new Error('The `key` is invalid.') }
    }
    if (!v) {
      v = 'address'
    }
    p.key = v
  }

  if ('wait' in params) {
    const v = params.wait
    if (typeof (v) !== 'number' || v <= 0 || v % 1 !== 0) {
      return { error: new Error('The `wait` is invalid.') }
    }
    p.wait = v
  }

  if ('quick' in params) {
    const v = params.quick
    if (typeof (v) !== 'boolean') {
      return { error: new Error('The `quick` must be a boolean.') }
    }
    p.quick = v
  } else {
    p.quick = false
  }

  if ('filter' in params) {
    const v = params.filter
    if (typeof (v) !== 'string' && typeof (v) !== 'function') {
      return { error: new Error('The `filter` must be a string.') }
    }
    if (v) {
      p.filter = v
    }
  }

  return { params: p }
}

DnsSd.prototype._startDiscovery = function (params) {
  const promise = new Promise((resolve, reject) => {
    this._discovered_devices = {}
    this._is_discovering = true
    const wait = (params && params.wait) ? params.wait : this._DISCOVERY_WAIT_DEFAULT
    // Create a request packet
    const buf = mDnsSdComposer.compose({
      name: params.name,
      type: params.type,
    })

    // Timer
    let send_timer = null
    let wait_timer = null

    const clearTimer = () => {
      if (send_timer) {
        clearTimeout(send_timer)
        send_timer = null
      }
      if (wait_timer) {
        clearTimeout(wait_timer)
        wait_timer = null
      }
      this._onreceive = () => { }
    }

    wait_timer = setTimeout(() => {
      clearTimer()
      resolve()
    }, wait * 1000)

    const { quick } = params
    let { key } = params
    if (!key) {
      key = 'address'
    }
    this._onreceive = (addr, packet) => {
      if (!this._isTargettedDevice(packet, params.name)) {
        return
      }
      const device = this._createDeviceObject(packet)
      if (!this._evaluateDeviceFilter(device, params.filter)) {
        return
      }
      if (key === 'fqdn') {
        const { fqdn } = device
        this._discovered_devices[fqdn] = device
      } else {
        this._discovered_devices[addr] = device
      }
      if (quick) {
        clearTimer()
        resolve()
      }
    }

    // Send a packet
    let send_num = 0
    const sendQueryPacket = () => {
      this._udp.send(buf, 0, buf.length, this._UDP_PORT, this._MULTICAST_ADDR, (error) => {
        if (error) {
          clearTimer()
          reject(error)
        } else {
          send_num++
          if (send_num < 3) {
            send_timer = setTimeout(() => {
              sendQueryPacket()
            }, 1000)
          } else {
            send_timer = null
          }
        }
      })
    }
    sendQueryPacket()
  })
  return promise
}

DnsSd.prototype._isTargettedDevice = function (packet, name_list) {
  let hit = false
  packet.answers.forEach((ans) => {
    const { name } = ans
    if (name && name_list.includes(name)) {
      hit = true
    }
  })
  return hit
}

DnsSd.prototype._evaluateDeviceFilter = function (device, filter) {
  if (filter) {
    const filter_type = typeof (filter)
    if (filter_type === 'string') {
      return this._evaluateDeviceFilterString(device, filter)
    }
    if (filter_type === 'function') {
      return this._evaluateDeviceFilterFunction(device, filter)
    }
    return false
  }
  return true
}

DnsSd.prototype._evaluateDeviceFilterString = function (device, filter) {
  if (device.fqdn && device.fqdn.includes(filter)) {
    return true
  }
  if (device.address && device.address.includes(filter)) {
    return true
  }
  if (device.modelName && device.modelName.includes(filter)) {
    return true
  }
  if (device.familyName && device.familyName.includes(filter)) {
    return true
  }
  return false
}

DnsSd.prototype._evaluateDeviceFilterFunction = function (device, filter) {
  let res = false
  try {
    res = filter(device)
  } catch (e) { }
  res = !!res
  return res
}

DnsSd.prototype._stopDiscovery = function () {
  const promise = new Promise((resolve) => {
    this._discovered_devices = {}
    this._is_discovering = false
    this._stopListening().then(() => {
      resolve()
    }).catch(() => {
      resolve()
    })
  })
  return promise
}

DnsSd.prototype._addMembership = function () {
  this._source_address_list.forEach((netif) => {
    try {
      this._udp.addMembership(this._MULTICAST_ADDR, netif)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`Catching error on address already in use: ${JSON.stringify(e)}`)
    }
  })
}

DnsSd.prototype._dropMembership = function () {
  this._source_address_list.forEach((netif) => {
    try {
      this._udp.dropMembership(this._MULTICAST_ADDR, netif)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`Catching error on dropMembership: ${JSON.stringify(e)}`)
    }
  })
}

DnsSd.prototype._getSourceAddressList = function () {
  const list = []
  const netifs = mOs.networkInterfaces()
  for (const dev in netifs) {
    netifs[dev].forEach((info) => {
      if (info.family === 'IPv4' && info.internal === false) {
        const m = info.address.match(ipv4Regex)
        if (m) {
          list.push(m[1])
        }
      }
    })
  }
  return list
}

/* ------------------------------------------------------------------
* Method: startMonitoring()
* ---------------------------------------------------------------- */
DnsSd.prototype.startMonitoring = function () {
  const promise = new Promise((resolve, reject) => {
    if (this._is_monitoring === true) {
      resolve()
      return
    }
    this._startListening().then(() => {
      this._is_monitoring = true
      resolve()
    }).catch((error) => {
      this._is_monitoring = false
      this._stopListening().then(() => {
        reject(error)
      })
    })
  })
  return promise
}

/* ------------------------------------------------------------------
* Method: stopMonitoring()
* ---------------------------------------------------------------- */
DnsSd.prototype.stopMonitoring = function () {
  return new Promise((resolve) => {
    this._is_monitoring = false
    this._stopListening().then(() => {
      resolve()
    }).catch(() => {
      resolve()
    })
  })
}

DnsSd.prototype._startListening = function () {
  const promise = new Promise((resolve, reject) => {
    if (this._is_listening === true) {
      resolve()
      return
    }
    // Get the source IP address
    this._source_address_list = this._getSourceAddressList()
    // Set up a UDP tranceiver
    this._udp = mDgram.createSocket({
      type: 'udp4',
      reuseAddr: true,
    })
    this._udp.once('error', (error) => {
      this._is_listening = false
      reject(error)
    })
    this._udp.once('listening', () => {
      this._udp.setMulticastLoopback(false)
      this._addMembership()
      this._is_listening = true
      resolve()
    })
    this._udp.on('message', (buf, rinfo) => {
      this._receivePacket(buf, rinfo)
    })
    this._udp.bind({ port: this._UDP_PORT }, () => {
      this._udp.removeAllListeners('error')
    })
  })
  return promise
}

DnsSd.prototype._stopListening = function () {
  return new Promise((resolve) => {
    this._dropMembership()
    if (this._is_discovering || this._is_monitoring) {
      resolve()
    } else {
      const cleanObj = () => {
        if (this._udp) {
          this._udp.unref()
          this._udp = null
        }
        this._is_listening = false
        resolve()
      }
      if (this._udp) {
        this._udp.removeAllListeners('message')
        this._udp.removeAllListeners('error')
        this._udp.removeAllListeners('listening')
        this._udp.close(() => {
          cleanObj()
        })
      } else {
        cleanObj()
      }
    }
  })
}

DnsSd.prototype._receivePacket = function (buf, rinfo) {
  const p = mDnsSdParser.parse(buf)
  if (!p) {
    return
  }
  p.address = rinfo.address
  if (this._is_discovering) {
    if (this._isAnswerPacket(p, rinfo.address)) {
      this._onreceive(rinfo.address, p)
    }
  }
  if (this._is_monitoring) {
    if (typeof (this.ondata) === 'function') {
      this.ondata(p)
    }
  }
}

DnsSd.prototype._isAnswerPacket = function (p, address) {
  if (this._source_address_list.includes(address)) {
    return false
  }
  if (!(p.header.qr === 1 && p.header.op === 0)) {
    return false
  }
  return true
}

export default new DnsSd()
