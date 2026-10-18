import { randomBytes } from 'node:crypto'

function generateRandomString(length) {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
}

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

function parseDeviceId(deviceId) {
  return deviceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace('sw', 'SW')
}

function parseError(err, hideStack = []) {
  let toReturn = err.message
  if (err?.stack?.length > 0 && !hideStack.includes(err.message)) {
    const stack = err.stack.split('\n')
    if (stack[1]) {
      toReturn += stack[1].replace('   ', '')
    }
  }
  return toReturn
}

/**
 * The entry for one channel in a device's `switches` array.
 *
 * A full report lists every channel in order, so position used to be enough.
 * But some devices (SmartWise two-channel switches, for one) send a partial
 * update holding only the channel that changed - always at position 0, with
 * its real channel in `outlet`. Reading by position then applied channel 2's
 * change to channel 1 (#804). When the entries carry `outlet`, match on it;
 * only a list without `outlet` numbers falls back to position.
 *
 * @param {Array<{outlet?: number, switch: string}>} switches the reported array
 * @param {number} index the zero-based channel wanted
 * @returns {{outlet?: number, switch: string}|undefined} that channel's entry
 */
function switchForChannel(switches, index) {
  if (!Array.isArray(switches)) {
    return undefined
  }
  if (switches.some(entry => typeof entry?.outlet === 'number')) {
    return switches.find(entry => entry?.outlet === index)
  }
  return switches[index]
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export {
  generateRandomString,
  hasProperty,
  parseDeviceId,
  parseError,
  sleep,
  switchForChannel,
}
