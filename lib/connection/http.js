import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'

import axios from 'axios'

import platformConsts from '../utils/constants.js'
import { sleep } from '../utils/functions.js'

export default class {
  constructor(platform) {
    // Set up variables from the platform
    this.appId = platform.config.appId || platformConsts.appId
    this.appSecret = platform.config.appSecret || platformConsts.appSecret
    this.countryCode = platform.config.countryCode
    this.debug = platform.config.debug
    this.homeList = []
    this.httpHost = platform.config.httpHost
    this.ignoredDevices = platform.ignoredDevices
    this.ignoredHomes = platform.config.ignoredHomes.split(',')
    this.lang = platform.lang
    this.log = platform.log
    this.mode = platform.config.mode
    this.obstructSwitches = platform.obstructSwitches
    this.password = platform.config.password
    this.sensorSwitches = Object
      .values(platform.deviceConf)
      .filter(el => el.sensorId && ['garage', 'lock'].includes(el.showAs))
      .map(el => el.sensorId)
    this.triedBase64 = false
    this.username = platform.config.username
  }

  async login() {
    try {
      // Used to log the user in and obtain the user api key and token
      const data = {
        countryCode: this.countryCode,
        password: this.password,
      }

      // See if the user has provided an email or phone as username
      if (this.username.includes('@')) {
        data.email = this.username
      } else {
        data.phoneNumber = this.username
      }

      // Log the data depending on the debug setting
      if (this.debug) {
        this.log('%s.', this.lang.sendLogin)
      }

      // Set up the request signature
      const dataToSign = createHmac('sha256', this.appSecret)
        .update(JSON.stringify(data))
        .digest('base64')

      // Send the request
      const res = await axios.post(`https://${this.httpHost}/v2/user/login`, data, {
        headers: {
          'Authorization': `Sign ${dataToSign}`,
          'Content-Type': 'application/json',
          'X-CK-Appid': this.appId,
          'X-CK-Nonce': Math.random()
            .toString(36)
            .substr(2, 8),
        },
      })

      // Parse the response
      const body = res.data
      if (body.error === 10004 && body?.data?.region) {
        // In this case the user has been given a different region so retry login
        const givenRegion = body.data.region

        // Check the new received region is valid
        switch (givenRegion) {
          case 'eu':
          case 'us':
          case 'as':
            this.httpHost = `${givenRegion}-apia.coolkit.cc`
            break
          case 'cn':
            this.httpHost = 'cn-apia.coolkit.cn'
            break
          default:
            throw new Error(`${this.lang.noRegionRec} - [${givenRegion}].`)
        }

        // Log the new http host if appropriate
        if (this.debug) {
          this.log('%s [%s].', this.lang.newRegionRec, this.httpHost)
        }

        // Retry the login with the new http host
        return await this.login()
      }

      if ([10001, 10014].includes(body.error) && !this.triedBase64) {
        // In this case the password is incorrect so try base64 decoding just once
        this.triedBase64 = true
        this.password = Buffer.from(this.password, 'base64')
          .toString('utf8')
          .replace(/\r\n|\n|\r/g, '')
          .trim()
        return await this.login()
      }

      if (body.data.at) {
        // User api key and token received successfully
        this.aToken = body.data.at
        this.apiKey = body.data.user.apikey
        return {
          aToken: this.aToken,
          apiKey: this.apiKey,
          httpHost: this.httpHost,
          password: this.password,
        }
      }
      if (body.error === 500) {
        // Retry if another attempt could be successful
        this.log.warn('%s.', this.lang.eweError)
        await sleep(30000)
        return await this.login()
      }
      if (body.msg) {
        throw new Error(body.msg + (body.error ? ` [${body.error}]` : ''))
      } else {
        throw new Error(`${this.lang.noAuthRec}.\n${JSON.stringify(body, null, 2)}`)
      }
    } catch (err) {
      // Check to see if it's a eWeLink server problem, and we can retry
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [login() - %s].', this.lang.httpRetry, err.code)
        await sleep(30000)
        return this.login()
      }
      // It's not a eWeLink problem so report the error back
      this.log.warn('%s.', this.lang.errLogin)
      if (err.message.includes('10003')) {
        this.log.warn('%s', this.lang.httpLogin10003)
      }
      throw err
    }
  }

  async getHomes() {
    // Used to get a user's home list
    try {
      // Send the request
      const res = await axios.get(`https://${this.httpHost}/v2/family`, {
        headers: {
          'Authorization': `Bearer ${this.aToken}`,
          'Content-Type': 'application/json',
          'X-CK-Appid': this.appId,
          'X-CK-Nonce': Math.random()
            .toString(36)
            .substr(2, 8),
        },
      })

      // Parse the response
      const body = res.data
      if (
        !body.data
        || body.error !== 0
        || !body.data.familyList
        || !Array.isArray(body.data.familyList)
      ) {
        throw new Error(JSON.stringify(body, null, 2))
      }

      // Add the home id to the global array of ids
      body.data.familyList.forEach((home) => {
        if (this.ignoredHomes.includes(home.id)) {
          return
        }
        this.log('%s [%s] [%s].', this.lang.fetchHome, home.name, home.id)
        this.homeList.push(home.id)
      })
    } catch (err) {
      // Check to see if it's a eWeLink server problem, and we can retry
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [getHomes() - %s].', this.lang.httpRetry, err.code)
        await sleep(30000)
        await this.getHomes()
      } else {
        // It's not a eWeLink problem so report the error back
        this.log.warn('%s.', this.lang.errGetHomes)
        throw err
      }
    }
  }

  async getDevices() {
    // Used to get a user's device list
    try {
      // Send the request to get a device list for each of the homes
      const fullDeviceList = []

      for (const homeId of this.homeList) {
        const res = await axios.get(`https://${this.httpHost}/v2/device/thing`, {
          headers: {
            'Authorization': `Bearer ${this.aToken}`,
            'Content-Type': 'application/json',
            'X-CK-Appid': this.appId,
            'X-CK-Nonce': Math.random()
              .toString(36)
              .substr(2, 8),
          },
          params: {
            num: 0,
            familyid: homeId,
          },
        })

        // Parse the response
        const body = res.data
        if (!body.data || body.error !== 0) {
          throw new Error(JSON.stringify(body, null, 2))
        }

        // The list also includes scenes, so we need to remove them
        if (body.data?.thingList.length > 0) {
          body.data.thingList.forEach(device => fullDeviceList.push(device))
        }
      }

      // Now we have a device list from all the eWeLink user homes
      const deviceList = []
      const sensorList = []
      const groupList = []
      fullDeviceList.forEach((d) => {
        // Check each item is a device and also remove any devices the user has ignored
        if (d?.itemData?.extra?.uiid && !this.ignoredDevices.includes(d.itemData.deviceid)) {
          // If in LAN mode then don't add to device list
          if (this.mode === 'lan' && !platformConsts.devices.lan.includes(d.itemData.extra.uiid)) {
            return
          }
          // Separate the sensors as these need to be set up last
          const isObstructSwitch = this.obstructSwitches[d.itemData.deviceid]
          const isSensorSwitch = this.sensorSwitches[d.itemData.deviceid]
          if (
            platformConsts.devices.garageSensors.includes(d.itemData.extra.uiid)
            || isObstructSwitch
            || isSensorSwitch
          ) {
            sensorList.push(d.itemData)
          } else {
            deviceList.push(d.itemData)
          }
        } else if (d.itemType === 3) {
          // Is a group
          groupList.push(d.itemData)
        }
      })

      // Sensors need to go last as they update garages that need to exist already
      return {
        httpDeviceList: deviceList.concat(sensorList),
        httpGroupList: groupList,
      }
    } catch (err) {
      // Check to see if it's a eWeLink server problem, and we can retry
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        // Retry if another attempt could be successful
        this.log.warn('%s [getDevices() - %s].', this.lang.httpRetry, err.code)
        await sleep(30000)
        return this.getDevices()
      }
      // It's not a eWeLink problem so report the error back
      this.log.warn('%s.', this.lang.errGetDevices)
      throw err
    }
  }

  async updateGroup(groupId, params) {
    // Used to get info about a specific device
    const res = await axios.post(
      `https://${this.httpHost}/v2/device/thing/status`,
      {
        type: 2,
        id: groupId,
        params,
      },
      {
        headers: {
          'Authorization': `Bearer ${this.aToken}`,
          'Content-Type': 'application/json',
          'X-CK-Appid': this.appId,
          'X-CK-Nonce': Math.random()
            .toString(36)
            .substr(2, 8),
        },
      },
    )

    // Parse the response
    const body = res.data
    if (!body.data || body.error !== 0) {
      throw new Error(JSON.stringify(body, null, 2))
    }
  }
}
