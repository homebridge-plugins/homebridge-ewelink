import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import platformConsts from '../lib/utils/constants.js'

/**
 * Every device model the settings screen offers must also be one the plugin
 * accepts. "Zigbee Multi Channel" was offered for multi-channel devices but
 * missing from the accepted list, so choosing it logged a false "is not
 * configured correctly so ignoring" warning.
 */
const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'))
const sections = Object.entries(schema.schema.properties)
  .filter(([, value]) => value.items?.properties?.deviceModel?.oneOf)

describe('the device models the settings screen offers', () => {
  it.each(sections.map(([key, value]) => [
    key,
    value.items.properties.deviceModel.oneOf.map(option => option.enum[0]),
  ]))('are all accepted for %s', (key, offered) => {
    expect(platformConsts.allowed.models[key]).toEqual(expect.arrayContaining(offered))
  })
})
