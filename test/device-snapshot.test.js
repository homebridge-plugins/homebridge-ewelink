import { describe, expect, it } from 'vitest'

import { buildHandler, everyHandler } from './build-handlers.js'

/**
 * A record of what every device handler builds: which HomeKit services it adds,
 * and which characteristics sit on those services.
 *
 * This exists so that a refactor can be shown to have changed nothing. The same
 * twelve-line constructor preamble is repeated in seventy-five of these files -
 * the logging switch, the deviceConf lookup - and collapsing it into a shared
 * base is the obvious next move. The failure that guards against is silent: a
 * device quietly loses a characteristic, nobody notices, and it surfaces as an
 * issue weeks later.
 *
 * Any diff here must be explained before it is accepted.
 * Run `npx vitest -u` to accept an intended change.
 */

// Homebridge adds this one itself with the same contents for every accessory,
// so recording it would be pages of identical noise
const IGNORED_SERVICE = 'AccessoryInformation'

/**
 * Builds one handler and reports what it left on the accessory.
 *
 * A handler that throws is recorded as throwing rather than skipped. Several of
 * these need a device shape this harness does not model, and a snapshot that
 * quietly omitted them would hide it when a refactor breaks one that used to
 * work.
 */
function describeHandler(name, Handler) {
  const { device: built, accessory, error } = buildHandler(name, Handler)
  if (error) {
    return `${name}\n  did not build: ${error}\n`
  }

  const lines = [name]
  if (built?.enableLogging !== undefined) {
    lines.push(`  logging: ${built.enableLogging ? 'on' : 'off'}${built.enableDebugLogging ? ' (debug)' : ''}`)
  }

  const services = accessory.services
    .filter(service => service.type !== IGNORED_SERVICE)
    .sort((a, b) => `${a.type}${a.subtype ?? ''}`.localeCompare(`${b.type}${b.subtype ?? ''}`))

  services.forEach((service) => {
    const subtype = service.subtype ? ` [${service.subtype}]` : ''
    lines.push(`  service: ${service.type}${subtype}${service.isPrimary ? ' *primary' : ''}`)
    ;[...service.characteristics.keys()].sort().forEach((char) => {
      const props = service.characteristics.get(char).props
      const shown = Object.keys(props).length > 0
        ? `  [${Object.entries(props).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}]`
        : ''
      lines.push(`    ${char}${shown}`)
    })
  })

  return `${lines.join('\n')}\n`
}

describe('the device handlers', () => {
  it('build the same services and characteristics as before', async () => {
    const snapshot = everyHandler()
      .map(([name, Handler]) => describeHandler(name, Handler))
      .join('\n')

    await expect(snapshot).toMatchFileSnapshot('./device-snapshot.txt')
  })

  it('covers every handler the plugin exports', () => {
    const handlers = everyHandler()

    // A guard on the guard: if the export shape changes and the walk above stops
    // finding the nested sets, the snapshot would silently shrink to nothing
    expect(handlers.length).toBeGreaterThan(60)
    expect(handlers.some(([name]) => name.startsWith('sim.'))).toBe(true)
    expect(handlers.some(([name]) => name.startsWith('zb.'))).toBe(true)
  })
})
