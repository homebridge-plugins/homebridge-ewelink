import { describe, expect, it } from 'vitest'

import HttpClient from '../lib/connection/http.js'
import platformLang from '../lib/utils/lang-en.js'

/**
 * An eWeLink access token lasts about a month. When it runs out, the cloud
 * mostly says so inside an ordinary response - error 401 or 402 in the body -
 * rather than with an http 401. Group commands are the only cloud requests
 * made after startup, so they were the ones that stopped working.
 */

function makeClient(responses) {
  const log = () => {}
  log.warn = () => {}
  log.debug = () => {}
  const client = new HttpClient({
    config: {
      countryCode: '+44',
      httpHost: 'eu-apia.coolkit.cc',
      ignoredHomes: '',
      mode: 'auto',
      password: 'password',
      username: 'user@example.com',
    },
    deviceConf: {},
    ignoredDevices: [],
    lang: platformLang,
    log,
    obstructSwitches: {},
  })
  client.aToken = 'old-token'

  // Each request gets the next canned reply, and is recorded
  const sent = []
  client.axiosClient.defaults.adapter = async (config) => {
    sent.push(config.headers.Authorization)
    return {
      config,
      data: responses.shift(),
      headers: {},
      status: 200,
      statusText: 'OK',
    }
  }
  client.login = async () => ({ aToken: 'new-token' })
  return { client, sent }
}

describe('a group command sent with an expired token', () => {
  it('logs in again and resends the command when the body says 401', async () => {
    const { client, sent } = makeClient([
      { error: 401, msg: 'token is expired' },
      { error: 0, data: {} },
    ])

    await expect(client.updateGroup('group1', { switch: 'on' })).resolves.toBeUndefined()
    expect(sent).toEqual(['Bearer old-token', 'Bearer new-token'])
  })

  it('does the same when the body says 402', async () => {
    const { client, sent } = makeClient([
      { error: 402, msg: 'token is expired' },
      { error: 0, data: {} },
    ])

    await expect(client.updateGroup('group1', { switch: 'on' })).resolves.toBeUndefined()
    expect(sent).toHaveLength(2)
  })

  it('only tries once, so a token the cloud keeps refusing cannot loop', async () => {
    const { client, sent } = makeClient([
      { error: 401, msg: 'token is expired' },
      { error: 401, msg: 'token is expired' },
    ])

    await expect(client.updateGroup('group1', { switch: 'on' })).rejects.toThrow()
    expect(sent).toHaveLength(2)
  })
})
