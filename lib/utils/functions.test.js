import { describe, expect, it } from 'vitest'

import { generateRandomString, hasProperty, parseDeviceId, parseError } from './functions.js'

describe('parseDeviceId', () => {
  it('strips punctuation and spacing users paste in from the app', () => {
    expect(parseDeviceId('10:00:ab:cd')).toBe('1000abcd')
    expect(parseDeviceId(' 1000abcd ')).toBe('1000abcd')
    expect(parseDeviceId('1000-abcd')).toBe('1000abcd')
  })

  it('lowercases the id, so matching is not case sensitive', () => {
    expect(parseDeviceId('1000ABCD')).toBe('1000abcd')
  })

  it('restores the SW marker, which is uppercase in a real device id', () => {
    // ⚠️ Deliberately documenting the current behaviour rather than asserting
    // it is ideal: the id is lowercased first, then the FIRST "sw" is put back
    // to uppercase. A second occurrence is left lowercase.
    expect(parseDeviceId('SW123')).toBe('SW123')
    expect(parseDeviceId('sw123')).toBe('SW123')
    expect(parseDeviceId('swsw')).toBe('SWsw')
  })

  it('accepts an id that is already clean', () => {
    expect(parseDeviceId('1000abcd')).toBe('1000abcd')
  })
})

describe('generateRandomString', () => {
  it('returns the requested length', () => {
    expect(generateRandomString(16)).toHaveLength(16)
  })

  it('uses only lowercase letters and digits', () => {
    expect(generateRandomString(200)).toMatch(/^[a-z0-9]+$/)
  })

  it('does not return the same value twice in a row', () => {
    expect(generateRandomString(32)).not.toBe(generateRandomString(32))
  })
})

describe('hasProperty', () => {
  it('detects own properties, including ones set to undefined', () => {
    // Device payloads regularly carry a key with no value, and that is
    // different from the key being absent.
    expect(hasProperty({ switch: undefined }, 'switch')).toBe(true)
    expect(hasProperty({}, 'switch')).toBe(false)
  })

  it('ignores inherited properties', () => {
    expect(hasProperty({}, 'toString')).toBe(false)
  })
})

describe('parseError', () => {
  it('appends the first stack frame to the message', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at thing (/a.js:1:1)'
    expect(parseError(err)).toBe('boom at thing (/a.js:1:1)')
  })

  it('hides the stack for errors the caller expects', () => {
    // The ACK timeout family (#773/#779) is noisy and routine, so those are
    // logged without a stack.
    const err = new Error('timeout')
    err.stack = 'Error: timeout\n    at thing (/a.js:1:1)'
    expect(parseError(err, ['timeout'])).toBe('timeout')
  })

  it('returns the message when there is no stack', () => {
    const err = new Error('nostack')
    err.stack = ''
    expect(parseError(err)).toBe('nostack')
  })
})
