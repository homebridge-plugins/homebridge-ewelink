function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  while (nonce.length < length) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
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
}
