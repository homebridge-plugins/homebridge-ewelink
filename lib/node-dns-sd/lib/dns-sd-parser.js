import { createRequire } from 'node:module'

/* ------------------------------------------------------------------
* node-dns-sd - dns-sd-parser.js
*
* Copyright (c) 2018-2019, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2018-02-27

* Related specifications:
* - RFC 1035 (DOMAIN NAMES - IMPLEMENTATION AND SPECIFICATION)
*     https://tools.ietf.org/html/rfc1035
* - RFC 6762 (Multicast DNS)
*     https://tools.ietf.org/html/rfc6762
* - RFC 6763 (DNS-Based Service Discovery)
*     https://tools.ietf.org/html/rfc6763
* - RFC 2782 (A DNS RR for specifying the location of services (DNS SRV))
*     https://tools.ietf.org/html/rfc2782
* ---------------------------------------------------------------- */

const require = createRequire(import.meta.url)

/* ------------------------------------------------------------------
* Constructor: DnsSdParser()
* ---------------------------------------------------------------- */
function DnsSdParser() {
  this._CLASSES = require('./dns-sd-classes.json')
  this._CLASS_MAP = {}
  Object.keys(this._CLASSES).forEach((k) => {
    this._CLASS_MAP[this._CLASSES[k]] = k
  })

  this._TYPES = require('./dns-sd-types.json')
  this._TYPE_MAP = {}
  Object.keys(this._TYPES).forEach((k) => {
    this._TYPE_MAP[this._TYPES[k]] = k
  })
}

/* ------------------------------------------------------------------
* Method: parse(buf)
* ---------------------------------------------------------------- */
DnsSdParser.prototype.parse = function (buf) {
  if (buf.length <= 12) {
    return null
  }
  const header = {
    id: buf.readUInt16BE(0),
    qr: buf.readUInt8(2) >> 7, // 0: Query, 1: Response
    op: (buf.readUInt8(2) & 0b01111000) >> 3, // 0: Normal query, 4: Notify, 5: Update
    aa: (buf.readUInt8(2) & 0b00000100) >> 2,
    tc: (buf.readUInt8(2) & 0b00000010) >> 1,
    rd: (buf.readUInt8(2) & 0b00000001),
    ra: (buf.readUInt8(3) & 0b10000000) >> 7,
    z: (buf.readUInt8(3) & 0b01000000) >> 6,
    ad: (buf.readUInt8(3) & 0b00100000) >> 5,
    cd: (buf.readUInt8(3) & 0b00010000) >> 4,
    rc: (buf.readUInt8(3) & 0b00001111),
    questions: buf.readUInt16BE(4),
    answers: buf.readUInt16BE(6),
    authorities: buf.readUInt16BE(8),
    additionals: buf.readUInt16BE(10),
  }
  if (header.tc !== 0 || header.rd !== 0 || header.ra !== 0 || header.z !== 0 || header.ad !== 0 || header.cd !== 0 || header.rc !== 0) {
    return null
  }
  if (header.questions + header.answers + header.authorities + header.additionals === 0) {
    return null
  }
  let offset = 12
  const records = {
    header,
    questions: [],
    answers: [],
    authorities: [],
    additionals: [],
  }
  const record_count_list = [];
  ['questions', 'answers', 'authorities', 'additionals'].forEach((k) => {
    const cnt = header[k]
    if (cnt > 0) {
      record_count_list.push({ name: k, count: cnt })
    }
  })
  let invalid = false
  while (true) {
    const parsed = this._parseLabel(buf, offset)
    let domain_name = ''
    if (parsed) {
      offset += parsed.length
      domain_name = parsed.name
    } else {
      invalid = true
      break
    }

    const record_key = record_count_list[0].name
    if (record_key === 'questions') {
      if (offset + 4 > buf.length) {
        invalid = true
        break
      }
      const type_value = buf.readUInt16BE(offset)
      const type = this._TYPE_MAP[type_value]
      offset += 2
      const cls_value = buf.readUInt16BE(offset)
      const cls = this._CLASS_MAP[cls_value]
      offset += 2
      records[record_key].push({
        name: domain_name,
        type: type || '',
        class: cls || '',
      })
    } else {
      if (offset + 10 > buf.length) {
        invalid = true
        break
      }
      const type_value = buf.readUInt16BE(offset)
      const type = this._TYPE_MAP[type_value] || ''
      offset += 2
      const cls_value = buf.readUInt16BE(offset)
      const cls = this._CLASS_MAP[cls_value & 0b0111111111111111]
      const flash = !!((cls_value & 0b1000000000000000))
      offset += 2
      const ttl = buf.readUInt32BE(offset)
      offset += 4
      const rdlen = buf.readUInt16BE(offset)
      offset += 2
      if (offset + rdlen > buf.length) {
        invalid = true
        break
      }
      let rdata = ''
      let rdata_txt_buffer = null
      if (type === 'A') {
        rdata = this._parseRdataA(buf, offset, rdlen)
      } else if (type === 'AAAA') {
        rdata = this._parseRdataAAAA(buf, offset, rdlen)
      } else if (type === 'PTR') {
        rdata = this._parseRdataPtr(buf, offset, rdlen)
      } else if (type === 'TXT') {
        rdata = this._parseRdataTxt(buf, offset, rdlen)
        rdata_txt_buffer = this._parseRdataTxt(buf, offset, rdlen, true)
      } else if (type === 'SRV') {
        rdata = this._parseRdataSrv(buf, offset, rdlen)
      } else if (type === 'HINFO') {
        rdata = this._parseRdataHinfo(buf, offset, rdlen)
      } else {
        rdata = this._parseRdataOther(buf, offset, rdlen)
      }
      offset += rdlen

      if (!rdata) {
        invalid = true
        break
      }

      const d = {
        name: domain_name,
        type: type || '',
        class: cls || '',
        flash,
        ttl,
        rdata,
      }
      if (rdata_txt_buffer) {
        d.rdata_buffer = rdata_txt_buffer
      }
      records[record_key].push(d)
    }

    if (offset >= buf.length) {
      break
    }
    record_count_list[0].count--
    if (record_count_list[0].count <= 0) {
      record_count_list.shift()
    }
    if (record_count_list.length === 0) {
      break
    }
  }
  if (invalid === true) {
    return null
  }
  return records
}

DnsSdParser.prototype._parseLabel = function (buf, offset) {
  try {
    const labels = []
    let length = 0
    let invalid = false
    while (true) {
      const label_len = buf.readUInt8(offset + length)
      if ((label_len & 0b11000000) === 0b11000000) {
        const i = buf.readUInt16BE(offset + length) & 0b0011111111111111
        const parsed = this._parseLabel(buf, i)
        if (parsed) {
          labels.push(parsed.name)
          length += 2
          break
        } else {
          invalid = true
          break
        }
      } else if ((label_len & 0b11000000) === 0b00000000) {
        length += 1
        if (label_len === 0x00) {
          break
        } else if (offset + length + label_len <= buf.length) {
          const label = buf.slice(offset + length, offset + length + label_len).toString('utf8')
          labels.push(label)
          length += label_len
        } else {
          invalid = true
          break
        }
      } else {
        invalid = true
        break
      }
    }
    if (invalid === true) {
      return null
    }
    return {
      name: labels.join('.'),
      length,
    }
  } catch (err) {
    return null
  }
}

DnsSdParser.prototype._parseRdataA = function (buf, offset, len) {
  const addr_parts = []
  for (let i = 0; i < len; i += 1) {
    addr_parts.push(buf.readUInt8(offset + i))
  }
  const addr = addr_parts.join('.')
  return addr
}

DnsSdParser.prototype._parseRdataAAAA = function (buf, offset, len) {
  const addr_parts = []
  for (let i = 0; i < len; i += 2) {
    addr_parts.push(buf.slice(offset + i, offset + i + 2).toString('hex'))
  }
  const addr = addr_parts.join(':')
  return addr
}

DnsSdParser.prototype._parseRdataPtr = function (buf, offset) {
  const parsed = this._parseLabel(buf, offset)
  if (parsed) {
    return parsed.name
  }
  return null
}

DnsSdParser.prototype._parseRdataTxt = function (buf, offset, len, buf_flag) {
  const labels = {}
  let i = 0
  while (true) {
    if (i >= len) {
      break
    }
    const blen = buf.readUInt8(offset + i)
    i += 1
    if (i + blen <= len) {
      const pair = buf.slice(offset + i, offset + i + blen).toString('utf8')
      const m = pair.match(/^([^=]+)=(.*)/)
      if (m) {
        labels[m[1]] = m[2]
        if (buf_flag) {
          const s = offset + i + m[1].length + 1
          const e = offset + i + blen
          labels[m[1]] = buf.slice(s, e)
        }
      }
      i += blen
    } else {
      break
    }
  }
  return labels
}

DnsSdParser.prototype._parseRdataSrv = function (buf, offset, len) {
  if (len <= 6) {
    return null
  }
  let target = null
  const parsed = this._parseLabel(buf, offset + 6)
  if (parsed) {
    target = parsed.name
  }
  return {
    priority: buf.readUInt16BE(offset),
    weight: buf.readUInt16BE(offset + 2),
    port: buf.readUInt16BE(offset + 4),
    target,
  }
}

DnsSdParser.prototype._parseRdataHinfo = function (buf, offset, len) {
  const txt_list = []
  let i = 0
  while (true) {
    if (i >= len) {
      break
    }
    const blen = buf.readUInt8(offset + i)
    i += 1
    if (i + blen <= len) {
      const v = buf.slice(offset + i, offset + i + blen).toString('utf8')
      txt_list.push(v)
      i += blen
    } else {
      break
    }
  }
  const info = {}
  if (txt_list[0]) {
    info.cpu = txt_list[0]
  }
  if (txt_list[1]) {
    info.os = txt_list[1]
  }
  return info
}

DnsSdParser.prototype._parseRdataOther = function (buf, offset, len) {
  const rdata_parts = []
  for (let i = 0; i < len; i += 1) {
    rdata_parts.push(buf.slice(offset + i, offset + i + 1).toString('hex'))
  }
  const rdata = rdata_parts.join(' ')
  return rdata
}

export default new DnsSdParser()
