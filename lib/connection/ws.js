import { randomBytes } from 'node:crypto'
import events from 'node:events'

import axios from 'axios'
import wsp from 'websocket-as-promised'
import ws from 'ws'

import platformConsts from '../utils/constants.js'
import { hasProperty, parseError, sleep } from '../utils/functions.js'

const emitter = new events()

export default class {
  constructor(platform, authData) {
    // Set up variables from the platform
    this.appId = platform.config.appId || platformConsts.appId
    this.appSecret = platform.config.appSecret || platformConsts.appSecret
    this.debug = platform.config.debug
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the authData (from HTTP)
    this.httpHost = authData.httpHost
    this.aToken = authData.aToken
    this.apiKey = authData.apiKey

    // Flag used to determine ws connection status
    this.wsIsConnected = false
  }

  async getHost() {
    // Used to get the web socket host
    try {
      // Send the HTTP request to get the web socket host
      const res = await axios({
        method: 'post',
        url: `https://${this.httpHost.replace('-api', '-disp')}/dispatch/app`,
        headers: {
          'Authorization': `Bearer ${this.aToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          appid: this.appId,
          nonce: randomBytes(4).toString('hex'),
          ts: Math.floor(Date.now() / 1000),
          version: 8,
        },
        timeout: 6000,
      })

      // Parse the response
      const body = res.data

      // Check for any reason a host wasn't received
      if (!body.domain) {
        throw new Error(this.lang.noWSHost)
      }

      // Log the received host if appropriate
      if (this.debug) {
        this.log('%s [%s].', this.lang.wsHostRec, body.domain)
      }

      // Return the received web socket host
      return body.domain
    } catch (err) {
      // Check to see if it's a eWeLink server problem, and we can retry
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        this.log.warn('%s [getHost() - %s].', this.lang.httpRetry, err.code)
        await sleep(30000)
        return this.getHost()
      }

      // Fall back to static pconnect hosts
      const region = this.httpHost.split('-')[0]
      const suffix = region === 'cn' ? 'coolkit.cn' : 'coolkit.cc'
      const fallback = `${region}-pconnect3.${suffix}`
      this.log.warn('%s [%s].', this.lang.errGetHost, fallback)
      return fallback
    }
  }

  async login() {
    // Used to create the web socket connection and authenticate
    try {
      // This may be called onClose and onError, we just want it to run once
      if (this.debounce) {
        return
      }
      this.debounce = true
      setTimeout(() => {
        this.debounce = false
      }, 4000)

      // Close any existing web socket connection
      await this.closeConnection()

      // Refresh the web socket host
      const wsHost = await this.getHost()

      // Create the web socket client
      this.wsClient = new wsp(`wss://${wsHost}:8080/api/ws`, {
        createWebSocket: url => new ws(url),
        extractMessageData: event => event,
        attachRequestId: (data, requestId) => ({ sequence: requestId, ...data }),
        extractRequestId: data => data && data.sequence,
        packMessage: data => JSON.stringify(data),
        unpackMessage: (data) => {
          data = data.toString()
          return data === 'pong' ? data : JSON.parse(data)
        },
        timeout: 20000,
      })

      // Add a listener to authenticate when a web socket connection is opened
      this.wsClient.onOpen.addListener(async () => {
        const sequence = Math.floor(new Date()).toString()

        // Generate the login payload for the web socket
        const payload = {
          action: 'userOnline',
          apikey: this.apiKey,
          appid: this.appId,
          at: this.aToken,
          nonce: randomBytes(4).toString('hex'),
          sequence,
          ts: Math.floor(new Date() / 1000),
          userAgent: 'app',
          version: 8,
        }

        // Log the web socket login if appropriate
        if (this.debug) {
          this.log('%s.', this.lang.wsLogin)
        }

        // Attempt to authenticate the web socket connection
        try {
          // Send the request
          const res = await this.wsClient.sendRequest(payload, {
            requestId: sequence,
          })

          // Parse the response
          if (res.config && res.config.hb && res.config.hbInterval) {
            // Update the flags
            this.wsIsConnected = true

            // Create a new ping interval
            this.hbInterval = setInterval(() => {
              try {
                // Send the ping
                this.wsClient.send('ping')
              } catch (err) {
                // Catch errors sending ping and show in debug mode
                if (this.debug) {
                  this.log.warn('%s %s.', this.lang.wsPingError, parseError(err))
                }
              }
            }, (res.config.hbInterval + 7) * 1000)

            // Login was successful and log if appropriate
            this.authRetries = 0
            if (this.debug) {
              this.log('%s.', this.lang.wsLoginSuccess)
            }
          } else if (res.error === 406) {
            // Token invalidated (e.g. concurrent session), re-authenticate with backoff
            this.log.warn(this.lang.wsLogin406)
            const delay = Math.min(5000 * 2 ** (this.authRetries || 0), 300000)
            this.authRetries = (this.authRetries || 0) + 1
            if (this.authRetries <= 10) {
              await sleep(delay)
              await this.login()
            }
          } else {
            // There was a problem with the authentication response
            const str = JSON.stringify(res, null, 2)
            throw new Error(`${this.lang.wsLoginErr}\n${str}`)
          }
        } catch (err) {
          // Catch any errors authenticating the WS connection
          this.log.warn('%s %s.', this.lang.wsLoginError, parseError(err))
        }
      })

      // Add a listener for when we receive a WS message
      this.wsClient.onUnpackedMessage.addListener((msg) => {
        // Don't continue if it's a simple pong
        if (msg === 'pong') {
          return
        }

        // Set a device online flag now which we can change later
        let onlineStatus = true

        // Set up a params object if one didn't already come within the message
        if (!msg.params) {
          msg.params = {}
        }

        // We received a device on/offline or error notification
        if (msg.deviceid && hasProperty(msg, 'error')) {
          msg.action = 'update'
          // Set the online status of the device
          onlineStatus = msg.error === 0
        }

        // Normally the WS messages comes with an action
        if (msg.action) {
          // Check which action the WS message includes
          switch (msg.action) {
            case 'update':
            case 'sysmsg': {
              if (msg.action === 'sysmsg' && hasProperty(msg.params, 'online')) {
                // Update the online/offline status provided in the message
                onlineStatus = msg.params.online
              }

              // Skip updates that only contain subDevRssi (stale Zigbee data)
              const paramKeys = Object.keys(msg.params).filter(k => k !== 'online')
              if (paramKeys.length === 1 && paramKeys[0] === 'subDevRssi') {
                break
              }

              // Loop through the device parameters received
              Object.keys(msg.params).forEach((param) => {
                // Remove any params that the plugin doesn't need
                if (!platformConsts.paramsToKeep.includes(param.replace(/\d/g, ''))) {
                  delete msg.params[param]
                }
              })

              if (Object.keys(msg.params).length > 0) {
                // Add more params to report back to the plugin
                msg.params.online = onlineStatus
                msg.params.updateSource = 'WS'

                // Generate the object to return to the plugin
                const returnTemplate = {
                  deviceid: msg.deviceid,
                  params: msg.params,
                }

                // Report the new device params object back to the plugin to deal with
                emitter.emit('update', returnTemplate)
              }
              break
            }
            case 'reportSubDevice':
            case 'subDevice':
              // We don't need to do anything with this action
              return
            default: {
              this.log.warn(
                '[%s] %s.\n%s',
                msg.deviceid,
                this.lang.wsUnkAct,
                JSON.stringify(msg, null, 2),
              )
            }
          }
        } else if (hasProperty(msg, 'error') && msg.error === 0) {
          // Process device params from unmatched responses (e.g. query results)
          if (msg.deviceid && msg.params) {
            msg.params.online = true
            msg.params.updateSource = 'WS'
            emitter.emit('update', { deviceid: msg.deviceid, params: msg.params })
          }
        } else {
          // WS message received has an unknown action
          this.log.warn('%s.\n%s', this.lang.wsUnkCmd, JSON.stringify(msg, null, 2))
        }
      })

      // Add a listener for when the web socket closes for any reason
      this.wsClient.onClose.addListener(async (e) => {
        // Don't continue further with logging/reconnection if it's a wanted closure
        if (e === 1005) {
          return
        }

        if (this.debug) {
          this.log.warn('%s [%s].', this.lang.wsReconnectError, e)
        }

        // Reconnect with exponential backoff
        this.reconnectAttempts = (this.reconnectAttempts || 0) + 1
        const delay = Math.min(5000 * 2 ** (this.reconnectAttempts - 1), 300000)
        await sleep(delay)
        await this.login()
      })

      // Add a listener for when the web socket throws an error
      this.wsClient.onError.addListener(async (e) => {
        if (this.debug) {
          this.log.warn('%s [%s].', this.lang.wsReconnectClose, e)
        }

        this.reconnectAttempts = (this.reconnectAttempts || 0) + 1
        const delay = Math.min(5000 * 2 ** (this.reconnectAttempts - 1), 300000)
        await sleep(delay)
        await this.login()
      })

      // Open the web socket connection
      await this.wsClient.open()

      // Reset reconnect counter on successful connection
      this.reconnectAttempts = 0
    } catch (err) {
      const errToShow = parseError(err)

      if (this.debug) {
        this.log('%s: %s.', this.lang.wsLoginErrRecon, errToShow)
      }

      this.reconnectAttempts = (this.reconnectAttempts || 0) + 1
      const delay = Math.min(5000 * 2 ** (this.reconnectAttempts - 1), 300000)
      await sleep(delay)
      await this.login()
    }
  }

  async sendUpdate(json, retries = 0) {
    // Generate the payload to send
    const toSend = {
      ...json,

      action: 'update',
      ts: 0,
      userAgent: 'app',
    }

    // Enforce minimum 100ms between cloud messages
    const now = Date.now()
    if (this.lastSendTime && now - this.lastSendTime < 100) {
      await sleep(100 - (now - this.lastSendTime))
    }
    this.lastSendTime = Date.now()

    // Check the web socket is open
    if (this.wsClient && this.wsIsConnected) {
      try {
        // Generate the sequence that will be attached to the message
        const sequence = Math.floor(new Date()).toString()

        // Send the request to eWeLink
        const res = await this.wsClient.sendRequest(toSend, {
          requestId: sequence,
        })

        // Parse the response and see if any error has been reported back
        res.error = hasProperty(res, 'error') ? res.error : -1

        // Check if and which error has been reported back
        switch (res.error) {
          case 0:
            // No error is always what is wanted
            if (res.config && res.config.hundredDaysKwhData) {
              return res.config.hundredDaysKwhData
            }
            return true
          case 504:
            throw new Error(`${this.lang.wsReqTimeout} [504]`)
          default:
            // An error has occurred
            throw new Error(`${this.lang.wsUnkRes} [${res.error}]`)
        }
      } catch (err) {
        // Retry up to 3 times on timeout
        if (retries < 3) {
          await sleep(1000)
          return this.sendUpdate(json, retries + 1)
        }
        throw new Error(parseError(err))
      }
    } else {
      // The web socket isn't currently open so log this
      throw new Error(this.lang.wsResend)
    }
  }

  receiveUpdate(f) {
    emitter.addListener('update', f)
  }

  async requestUpdate(accessory) {
    // Don't continue if disabled for any eWeLink UIID
    if (platformConsts.devices.skipUpdateRequest.includes(accessory.context.eweUIID)) {
      return
    }

    // Log the action if appropriate
    if (accessory.control.enableDebugLogging) {
      this.log('[%s] %s.', accessory.displayName, this.lang.updReq)
    }

    // Generate the payload to send
    const json = {
      action: 'query',
      apikey: accessory.context.eweApiKey,
      deviceid: accessory.context.eweDeviceId,
      params: [],
      sequence: Math.floor(new Date()).toString(),
      ts: 0,
      userAgent: 'app',
    }

    // Check the web socket is open
    if (this.wsClient && this.wsIsConnected) {
      // Send the request
      this.wsClient.send(JSON.stringify(json))
    } else {
      // The web socket isn't currently open so log this
      throw new Error(this.lang.wsResend)
    }
  }

  async closeConnection() {
    // This is called when refreshing connection or if Homebridge shuts down

    // Clear any existing ping interval
    if (this.hbInterval) {
      clearInterval(this.hbInterval)
      this.hbInterval = null
    }

    // Check the ws client is set up
    if (this.wsClient) {
      // Remove any existing listeners
      this.wsClient.removeAllListeners()

      // Close the web socket connection
      if (this.wsIsConnected) {
        // Set the connection flag to false
        this.wsIsConnected = false

        // Close the connection
        await this.wsClient.close()

        // Log if appropriate
        if (this.debug) {
          this.log('%s.', this.lang.stoppedWS)
        }
      }
    }
  }
}
