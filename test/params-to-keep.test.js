import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import platformConsts from '../lib/utils/constants.js'

/**
 * Live updates, over the web socket and the LAN, pass through a filter that
 * throws away every param not in paramsToKeep. Only the device list fetched at
 * startup skips it. So a param a handler reads but the filter drops works once,
 * at startup, and then never changes again - which looks like a slow device
 * rather than a bug.
 *
 * This reads every handler and checks each param it looks for would survive.
 */

const deviceDir = fileURLToPath(new URL('../lib/device', import.meta.url))

// Params the plugin adds to an update itself, rather than receiving them
const ADDED_BY_PLUGIN = new Set(['operSide', 'updateSource'])

/** The same check ws.js and lan.js make on each incoming param. */
function isKept(param) {
  return platformConsts.paramsToKeep.includes(param)
    || platformConsts.paramsToKeep.includes(param.replace(/\d/g, ''))
}

function handlerFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return handlerFiles(path)
    }
    return path.endsWith('.js') && !path.endsWith('.test.js')
      ? [path]
      : []
  })
}

/** Every param a handler reads, with the files that read it. */
function paramsRead() {
  const found = new Map()
  const pattern = /hasProperty\(params, '(\w+)'\)|params\.([A-Z_a-z]\w*)|params\['(\w+)'\]/g
  handlerFiles(deviceDir).forEach((file) => {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const param = match[1] || match[2] || match[3]
      if (!found.has(param)) {
        found.set(param, new Set())
      }
      found.get(param).add(relative(deviceDir, file))
    }
  })
  return found
}

describe('the live update filter', () => {
  it('keeps every param a device handler reads', () => {
    const dropped = Array.from(paramsRead())
      .filter(([param]) => !ADDED_BY_PLUGIN.has(param) && !isKept(param))
      .map(([param, files]) => `${param} (${[...files].join(', ')})`)

    expect(dropped).toEqual([])
  })

  it('keeps the light level of the zigbee motion and presence sensors', () => {
    // brState is the bright/dark reading and illumination the lux reading
    expect(isKept('brState')).toBe(true)
    expect(isKept('illumination')).toBe(true)
  })

  it('keeps a param whose name only works with its digits', () => {
    // Stripped of digits this would be 'phase__p', so it needs its own entry
    expect(isKept('phase_0_p')).toBe(true)
  })
})
