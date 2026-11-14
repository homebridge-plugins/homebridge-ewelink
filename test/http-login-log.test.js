import axios from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import HttpClient, { maskUsername } from '../lib/connection/http.js'
import platformLang from '../lib/utils/lang-en.js'

/**
 * A user whose login kept failing with 10014 could not tell from the debug log
 * which server the plugin used, or what it sent the login as (#818). The debug
 * line now says both, with the number or email masked so the log can be shared.
 */

const defaultAdapter = axios.defaults.adapter
afterEach(() => {
  axios.defaults.adapter = defaultAdapter
})

function makeClient(username) {
  const lines = []
  const log = () => {}
  log.warn = () => {}
  log.debug = (...args) => lines.push(args)
  const client = new HttpClient({
    config: {
      countryCode: '+886',
      httpHost: 'as-apia.coolkit.cc',
      ignoredHomes: '',
      mode: 'auto',
      password: 'password',
      username,
    },
    deviceConf: {},
    ignoredDevices: [],
    lang: platformLang,
    log,
    obstructSwitches: {},
  })
  axios.defaults.adapter = async config => ({
    config,
    data: { data: {}, error: 10014, msg: 'account or password error!' },
    headers: {},
    status: 200,
    statusText: 'OK',
  })
  return { client, lines }
}

describe('the http login debug line', () => {
  it('names the server, the login type and the country code, with the number masked', async () => {
    const { client, lines } = makeClient('+886912345678')
    await expect(client.login()).rejects.toThrow('10014')

    const sendLine = lines.find(args => args[1] === platformLang.sendLogin)
    expect(sendLine).toEqual([
      '%s to [%s] with %s [%s] and country code [%s].',
      platformLang.sendLogin,
      'as-apia.coolkit.cc',
      'phone number',
      '+8869******78',
      '+886',
    ])
    expect(JSON.stringify(lines)).not.toContain('912345678')
  })

  it('says when it retries the password as base64', async () => {
    const { client, lines } = makeClient('+886912345678')
    await expect(client.login()).rejects.toThrow('10014')
    expect(lines.some(args => args[1] === platformLang.loginBase64)).toBe(true)
  })
})

describe('maskUsername', () => {
  it('keeps the length, the start and the last two digits of a phone number', () => {
    expect(maskUsername('+886912345678')).toBe('+8869******78')
    expect(maskUsername('+886912345678')).toHaveLength(13)
  })

  it('keeps the first letter and the domain of an email', () => {
    expect(maskUsername('someone@example.com')).toBe('s***@example.com')
  })

  it('hides all but the last two characters of a short value', () => {
    expect(maskUsername('123456')).toBe('****56')
  })
})
