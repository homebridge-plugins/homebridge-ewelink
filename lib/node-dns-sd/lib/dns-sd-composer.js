import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'

/* ------------------------------------------------------------------
* node-dns-sd - dns-sd-composer.js
*
* Copyright (c) 2017, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2018-10-25
* ---------------------------------------------------------------- */

/* ------------------------------------------------------------------
* Constructor: DnsSdComposer()
* ---------------------------------------------------------------- */

const require = createRequire(import.meta.url)

function DnsSdComposer() {
  this._CLASSES = require('./dns-sd-classes.json')
  this._TYPES = require('./dns-sd-types.json')
}

/* ------------------------------------------------------------------
* Method: compose(params)
* - params:
*   - name    | Array  | Requred  | Servcie name.(e.g., ["_googlecast._tcp.local"])
*   - type    | String | Optional | Query Type (e.g., "PTR"). The default value is "*"
* ---------------------------------------------------------------- */
DnsSdComposer.prototype.compose = function (params) {
  const name_list = params.name
  const type_name = params.type
  let type_code = 0xFF
  if (type_name) {
    if (typeof (type_name) === 'string') {
      if (this._TYPES[type_name]) {
        type_code = this._TYPES[type_name]
      } else {
        throw new Error(`The specified query type name is unknown: ${type_name}`)
      }
    } else {
      throw new TypeError('The specified query type is invalid.')
    }
  }

  const hbuf = Buffer.from([ // Header
    0x00,
    0x00, // Transaction ID
    0x00,
    0x00, // Flags
    0x00,
    name_list.length, // Questions
    0x00,
    0x00, // Answer PRs
    0x00,
    0x00, // Authority PRs
    0x00,
    0x00, // Additional PRs
  ])

  const qbuf_list = []
  name_list.forEach((name) => {
    (name.split('.')).forEach((part) => {
      const part_buf = Buffer.from(part, 'utf8')
      qbuf_list.push(Buffer.from([part_buf.length]))
      qbuf_list.push(part_buf)
    })
    qbuf_list.push(Buffer.from([0x00])) // Null-terminated string for the domain name

    const type_buf = Buffer.alloc(2)
    type_buf.writeUInt16BE(type_code, 0)
    qbuf_list.push(type_buf)

    const class_buf = Buffer.alloc(2)
    class_buf.writeUInt16BE(this._CLASSES.IN, 0)
    qbuf_list.push(class_buf)
  })
  const qbuf = Buffer.concat(qbuf_list)

  const buf = Buffer.concat([hbuf, qbuf])
  return buf
}

export default new DnsSdComposer()
