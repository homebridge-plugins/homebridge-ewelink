import { Buffer } from 'node:buffer'

export default class {
  constructor(platform, devicesInHB) {
    // Set up variables from the platform
    this.config = platform.config
    this.devicesInHB = devicesInHB
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.hapUUIDGen = platform.api.hap.uuid.generate
    this.log = platform.log
  }

  showHome() {
    // Return the home page for the API
    return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-wEmeIV1mKuiNpC+IOBjI7aAzPcEZeedi5yW5f2yOq55WWLwNGmvvx4Um1vskeMj0" crossorigin="anonymous">
        <title>homebridge-ewelink API Docs</title>
      </head>
      <body>
        <div class="container-fluid my-3">
          <div class="row content">
            <div class="col-lg-2"></div>
            <div class="col-lg-8">
              <p class="text-center">
                <img src="https://user-images.githubusercontent.com/43026681/101325266-63126600-3863-11eb-9382-4a2924f0e540.png" alt="homebridge-ewelink logo" style="width: 60%;">
                <h4 class="text-center">homebridge-ewelink</h3>
              </p>
              <hr class="mb-0">
              <h5 class="mt-4 mb-2">Intro</h5>
              <ul class="small">
                <li>The internal API allows you to query and control your homebridge-ewelink accessories using HTTP requests</li>
              </ul>
              <h5 class="mt-4 mb-2">Documentation</h5>
              <ul class="small">
                <li>All requests are of type <code>HTTP GET</code></li>
                <li>All requests must include an HTTP authentication header in the form:
                  <ul>
                    <li><code>Authorization: "Basic %%%"</code></li>
                    <li>Where <code>%%%</code> is a base64-encoded string of your eWeLink credentials in the form <code>username:password</code></li>
                  </ul>
                </li>
                <li>All requests will return a <code>HTTP 200 OK</code> success code with a JSON response</li>
                <li>Success or failure of any request can be determined by the <code>success</code> response property which will be <code>true</code> or <code>false</code></li>
                <li>Error messages will be returned in the <code>error</code> parameter as a <code>string</code></li>
                <li>Replace <code>{hbDeviceId}</code> with the Homebridge ID of the device, e.g. <code>10000abcdeSWX</code></li>
                <li>A note about offline devices:
                  <ul>
                    <li>Querying any characteristic will return the HomeKit cache value</li>
                    <li>Updating a characteristic which matches the HomeKit cache value will return a <code>success:true</code> response</li>
                    <li>Updating a characteristic which does not match the HomeKit cache value will return a <code>success:false</code> with an <code>error:"HAP Status Error: -70402"</code> response</li>
                  </ul>
                </li>
              </ul>
              <div class="alert alert-secondary small text-center" role="alert" style="display: none;" id="baseUrlBanner"></div>
              <h5 class="mt-4 mb-2">Accessory Query Commands</h5>
              <div class="table-responsive">
                <table class="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th scope="col" class="small" style="width: 50%;">Function</th>
                      <th scope="col" class="small" style="width: 50%;">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="small">
                        <strong>Obtain a device list.</strong><br>
                        <code>response</code> property is an <code>array</code>, for example:<br>
                        <code><pre>{
  "success": true,
  "response":[
    {
      "name": "Bedroom Switch",
      "hbdeviceid": "1000aa1a1aSW1",
      "status": {
        "wan": true,
        "lan": true,
        "ip": "192.168.1.20"
      }
    }
  ]
}</pre>
                        </code>
                      </td>
                      <td class="align-middle small"><code>/get/devicelist</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        <strong>Obtain a device's current state.</strong><br>
                        <code>response</code> property is an <code>object</code>, for example:<br>
                        <code><pre>{
  "success": true,
  "response": {
    "status": {
      "wan": true,
      "lan": true,
      "ip": "192.168.1.20"
    },
    "services": ["switch"],
    "switch": {
      "state": "off"
    }
  }
}</pre>
                        </code>
                      </td>
                      <td class="align-middle small"><code>/get/{hbDeviceId}</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul class="small">
                <li><code>services</code> is an array of services that the device has</li>
                <li>Possible services include <code>switch</code>, <code>outlet</code>, <code>light</code>, <code>fan</code>, <code>temperature</code> and <code>humidity</code>
                <li>Each service will have a corresponding property of characteristic(s)
                  <ul>
                    <li>In the above example the service is <code>switch</code> and the only characteristic is <code>state</code></li>
                  </ul>
                </li>
                <li>Use the service and characteristic when using the below commands to control an accessory</li>
              </ul>
              <h5 class="mt-4 mb-2">Accessory Control Commands</h5>
              <div class="table-responsive">
                <table class="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th scope="col" class="small" style="width: 50%;">Function</th>
                      <th scope="col" class="small" style="width: 50%;">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                  <tr>
                    <td class="small">Template</td>
                    <td class="align-middle small"><code>/set/{hbDeviceId}/{service}/{characteristic}/{value}</code></td>
                  </tr>
                    <tr>
                      <td class="small">
                        Service: <code>switch</code>.<br>
                        Characteristic: <code>state</code>.<br>
                        Value: must be <code>on</code>, <code>off</code> or <code>toggle</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/switch/state/on</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>outlet</code>.<br>
                        Characteristic: <code>state</code>.<br>
                        Value: must be <code>on</code>, <code>off</code> or <code>toggle</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/outlet/state/off</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>light</code>.<br>
                        Characteristic: <code>state</code>.<br>
                        Value: must be <code>on</code>, <code>off</code> or <code>toggle</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/light/state/on</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>light</code>.<br>
                        Characteristic: <code>brightness</code>.<br>
                        Value: must be between <code>0</code> and <code>100</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/light/brightness/54</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>light</code>.<br>
                        Characteristic: <code>hue</code>.<br>
                        Value: must be between <code>0</code> and <code>360</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/light/hue/157</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>light</code>.<br>
                        Characteristic: <code>colourtemperature</code>.<br>
                        Value: must be between <code>140</code> and <code>500</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/light/colourtemperature/300</code></td>
                    </tr>
                    <tr>
                      <td class="small">
                        Service: <code>fan</code>.<br>
                        Characteristic: <code>speed</code>.<br>
                        Value: must be <code>low</code>, <code>medium</code> or <code>high</code>.
                      </td>
                      <td class="align-middle small"><code>/set/{hbDeviceId}/fan/speed/medium</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="col-lg-2"></div>
          </div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0/dist/js/bootstrap.min.js" integrity="sha384-lpyLfhYuitXl2zRZ5Bn2fqnhNAKOAaM/0Kr9laMspuaMiZfGmfwRNFh8HlMy49eQ" crossorigin="anonymous"></script>
        <script>
          const base = window.location.href.slice(0, -1)
          const banner = document.getElementById('baseUrlBanner')
          banner.innerHTML = 'All paths are relative to <strong><code>' + base + '</code></strong>'
          banner.style.display = 'block'
        </script>
      </body>
    </html>`
  }

  async action(req) {
    // Log the request if appropriate
    this.log.debug('API request [%s].', req.url)

    // Authenticate the request
    if (
      !req.headers
      || !req.headers.authorization
      || !req.headers.authorization.includes('Basic ')
    ) {
      throw new Error('Invalid authentication')
    }
    const encodedCreds = req.headers.authorization.split(' ')[1]
    const buff = Buffer.from(encodedCreds, 'base64')
    const decodedCreds = buff
      .toString('utf8')
      .replace(/\r\n|\n|\r/g, '')
      .trim()
    const [user, pass] = decodedCreds.split(':')
    if (user !== this.config.username || pass !== this.config.password) {
      throw new Error('Invalid authentication')
    }

    // Obtain the parts of the request url
    const pathParts = req.url.split('/')
    const action = pathParts[1]
    const device = pathParts[2]
    const servToUpdate = pathParts[3]
    const charToUpdate = pathParts[4]
    const newValue = pathParts[5]

    // Check an action was specified
    if (!action) {
      throw new Error('No action specified')
    }

    // Check the action is either get or set
    if (!['get', 'set'].includes(action)) {
      throw new Error('Action must be \'get\' or \'set\'')
    }

    // Check a device was specified
    if (!device) {
      throw new Error('No accessory specified')
    }

    // Special case for the device list
    if (device === 'devicelist') {
      const deviceList = []
      this.devicesInHB.forEach((accessory) => {
        if (accessory.context.hidden) {
          return
        }
        deviceList.push({
          name: accessory.displayName,
          hbdeviceid: accessory.context.hbDeviceId,
          status: {
            wan: !!accessory.context.reachableWAN,
            lan: !!accessory.context.reachableLAN,
            ip: accessory.context.ip || false,
          },
        })
      })
      return deviceList
    }

    // Try and find the device in Homebridge
    const uuid = this.hapUUIDGen(device)
    if (!this.devicesInHB.has(uuid)) {
      throw new Error('Accessory not found in Homebridge')
    }

    // Obtain the corresponding accessory
    const accessory = this.devicesInHB.get(uuid)

    // Check the accessory isn't hidden from Homebridge
    if (accessory.context.hidden) {
      throw new Error('Accessory not found in Homebridge')
    }

    // Check the device is controllable
    if (!accessory.control) {
      throw new Error('Accessory has not been initialised yet')
    }

    // If the action is 'get' then return the properties
    if (action === 'get') {
      if (!accessory.control.currentState()) {
        throw new Error('Accessory does not yet support querying')
      }
      return {
        status: {
          wan: !!accessory.context.reachableWAN,
          lan: !!accessory.context.reachableLAN,
          ip: accessory.context.ip || false,
        },
        ...(await accessory.control.currentState()),
      }
    }

    // From now on the action must be 'set'

    // Check a servToUpdate to update was specified
    if (!servToUpdate) {
      throw new Error('No service specified')
    }

    let service
    switch (servToUpdate) {
      case 'fan':
        service = this.hapServ.Fan
        break
      case 'light':
        service = this.hapServ.Lightbulb
        break
      case 'outlet':
        service = this.hapServ.Outlet
        break
      case 'switch':
        service = this.hapServ.Switch
        break
      default:
        throw new Error('Invalid service specified')
    }

    if (!accessory.getService(service)) {
      throw new Error(`Accessory does not have service:${servToUpdate}`)
    }

    // Check an charToUpdate for a servToUpdate was specified
    if (!charToUpdate) {
      throw new Error(`No characteristic specified for service:${servToUpdate}`)
    }

    const accServ = accessory.getService(service)

    // These variables depend on the charToUpdate that was supplied
    let charName

    switch (charToUpdate) {
      case 'adaptivelighting':
      case 'colourtemperature':
        charName = accServ.testCharacteristic(this.hapChar.ColorTemperature)
          ? this.hapChar.ColorTemperature
          : false
        break
      case 'brightness':
        charName = accServ.testCharacteristic(this.hapChar.Brightness)
          ? this.hapChar.Brightness
          : false
        break
      case 'hue':
        charName = accServ.testCharacteristic(this.hapChar.Hue) ? this.hapChar.Hue : false
        break
      case 'speed':
        charName = accServ.testCharacteristic(this.hapChar.RotationSpeed)
          ? this.hapChar.RotationSpeed
          : false
        break
      case 'state':
        charName = accServ.testCharacteristic(this.hapChar.On) ? this.hapChar.On : false
        break
      default:
        throw new Error(`Invalid characteristic specified for service:${servToUpdate}`)
    }

    // Check that the accessory has the corresponding characteristic for the charToUpdate
    if (!charName) {
      throw new Error(
        `Accessory service:${servToUpdate} does not support characteristic:${charToUpdate}`,
      )
    }

    // Check a new status was supplied if the action is set
    if (!newValue) {
      throw new Error(`No value specified for characteristic:${charToUpdate}`)
    }

    let newHKStatus
    switch (charToUpdate) {
      case 'brightness': {
        // The new status for brightness must be an integer between 0 and 100
        newHKStatus = Number.parseInt(newValue, 10)
        if (Number.isNaN(newHKStatus) || newHKStatus < 0 || newHKStatus > 100) {
          throw new Error('Value must be integer 0-100 for characteristic:brightness')
        }

        // Check the accessory has a correct set handler for on/off
        if (!accessory.control.internalBrightnessUpdate) {
          throw new Error('Function to control accessory not found')
        }

        // Call the set handler to send the request to eWeLink
        await accessory.control.internalBrightnessUpdate(newHKStatus)
        break
      }
      case 'colourtemperature': {
        // The new status for colour temperature must be an integer between 140 and 500
        newHKStatus = Number.parseInt(newValue, 10)
        if (Number.isNaN(newHKStatus) || newHKStatus < 140 || newHKStatus > 500) {
          throw new Error('Value must be integer 140-500 for characteristic:colourtemperature')
        }

        // Check the accessory has a correct set handler for on/off
        if (!accessory.control.internalCTUpdate) {
          throw new Error(`Accessory does not support controlling characteristic:${charToUpdate}`)
        }

        // Call the set handler to send the request to eWeLink
        if (accessory?.alController?.isAdaptiveLightingActive()) {
          accessory.alController.disableAdaptiveLighting()
        }
        await accessory.control.internalCTUpdate(newHKStatus)
        break
      }
      case 'hue': {
        // The new status for hue must be an integer between 0 and 360
        newHKStatus = Number.parseInt(newValue, 10)
        if (Number.isNaN(newHKStatus) || newHKStatus < 0 || newHKStatus > 360) {
          throw new Error('Value must be integer 0-360 for characteristic:hue')
        }

        // Check the accessory has a correct set handler for on/off
        if (!accessory.control.internalColourUpdate) {
          throw new Error('Function to control accessory not found')
        }

        // Call the set handler to send the request to eWeLink
        if (accessory?.alController?.isAdaptiveLightingActive()) {
          accessory.alController.disableAdaptiveLighting()
        }
        await accessory.control.internalColourUpdate(newHKStatus)
        break
      }
      case 'speed':
        // The new status for speed must be low, medium or high
        switch (newValue) {
          case 'low':
            newHKStatus = 33
            break
          case 'medium':
            newHKStatus = 66
            break
          case 'high':
            newHKStatus = 99
            break
          default:
            throw new Error('Value must be \'low\', \'medium\' or \'high\' for characteristic:speed')
        }

        // Check the accessory has a correct set handler for speed
        if (!accessory.control.internalSpeedUpdate) {
          throw new Error('Function to control accessory not found')
        }

        // Call the set handler to send the request to eWeLink
        await accessory.control.internalSpeedUpdate(newHKStatus)
        break
      case 'state':
        // The new status for state must be on, off or toggle
        switch (newValue) {
          case 'on':
            newHKStatus = true
            break
          case 'off':
            newHKStatus = false
            break
          case 'toggle':
            newHKStatus = !accServ.getCharacteristic(this.hapChar.On).value
            break
          default:
            throw new Error('Value must be \'on\', \'off\' or \'toggle\' for characteristic:state')
        }

        // Check the accessory has a correct set handler for on/off
        if (!accessory.control.internalStateUpdate) {
          throw new Error('Function to control accessory not found')
        }

        // Call the set handler to send the request to eWeLink
        await accessory.control.internalStateUpdate(newHKStatus)
        break
      default:
        throw new Error(`Invalid value for characteristic:${charToUpdate}`)
    }

    // The eWeLink request was successful so update the characteristic in HomeKit
    accServ.updateCharacteristic(charName, newHKStatus)
    return true
  }
}
