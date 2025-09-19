# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- **Lint code**: `npm run lint`
- **Fix lint issues**: `npm run lint:fix`

## Architecture

### Core Structure
This is a Homebridge plugin that integrates eWeLink devices into HomeKit. The main entry point is `lib/index.js` which registers the platform with Homebridge.

### Key Components

**Platform Layer** (`lib/platform.js`)
- Main platform class that coordinates all plugin operations
- Manages device discovery, initialization, and lifecycle
- Handles configuration and storage via node-persist
- Implements request queue with p-queue for rate limiting
- Routes devices to appropriate handlers based on UIID and configuration

**Connection Layer** (`lib/connection/`)
- `api.js`: Internal HTTP API server for local control
- `http.js`: eWeLink cloud API client
- `lan.js`: Local network device control
- `ws.js`: WebSocket client for real-time updates

**Device Layer** (`lib/device/`)
- Individual device type implementations (switches, lights, sensors, etc.)
- Each device type extends base functionality with specific HomeKit characteristics
- Supports various Sonoff/eWeLink device models
- Device types include:
  - Single/Multi switches with optional power monitoring
  - RGB/CCT/Dimmable lights
  - Sensors (ambient, contact, motion, water)
  - Thermostats, fans, curtains
  - RF Bridge devices
  - Zigbee devices (via bridge)
  - Groups and simulations

**Utilities** (`lib/utils/`)
- `constants.js`: Device configurations and UIID mappings
- `functions.js`: Shared utility functions
- `custom-chars.js`: Custom HomeKit characteristics
- `eve-chars.js`: Eve Home app specific characteristics
- Language files for internationalization

### Device Identification (UIID)
Every eWeLink device has a UIID (unique interface ID) that determines its capabilities:

**Key UIID Categories** (defined in `lib/utils/constants.js`):
- `switchSingle`: [1, 6, 14, 24, 27, etc.] - Basic on/off switches
- `switchSinglePower`: [5, 32] - Switches with power monitoring
- `switchMulti`: [2, 3, 4, 7, 8, 9, etc.] - Multi-channel switches
- `lightRGB`: [22] - RGB color lights
- `lightCCT`: [103] - Color temperature lights
- `lightRGBCCT`: [33, 59, 104, etc.] - Full color + temperature lights
- `lightDimmer`: [36, 44, 57] - Dimmable lights
- `sensorContact`: [102, 154] - Door/window sensors
- `sensorAmbient`: [15, 181] - Temperature/humidity sensors
- `thermostat`: [127] - Smart thermostats
- `rfBridge`: [28, 98] - RF 433MHz bridges
- `zbBridge`: [66, 128, 168] - Zigbee bridges
- Zigbee prefixed devices (1000-7000 range)

**Device Routing Logic** (in `lib/platform.js:initialiseDevice()`):
1. Checks device UIID against category arrays in constants
2. Considers user configuration (showAs property for simulations)
3. Creates appropriate device handler instance
4. Special handling for:
   - Power monitoring devices (different decimal places)
   - Multi-channel devices (individual switches/outlets)
   - Bridge devices (RF/Zigbee sub-devices)
   - Simulated accessories (garage doors, valves, etc.)

### Communication Flow
1. Plugin authenticates with eWeLink cloud to fetch device list
2. Attempts local (LAN) control first for supported devices
3. Falls back to cloud control via HTTP/WebSocket if local fails
4. Maintains real-time sync through WebSocket connection
5. Exposes optional internal API for external control

### Command & Payload Structure

**HTTP Connection** (`lib/connection/http.js`)
- **Login**: POST to `/v2/user/login`
  - Request: `{email/phoneNumber, password, countryCode}`
  - Response: Returns `at` (access token) and `apikey`
  - Uses HMAC-SHA256 signature with app secret
- **Get Homes**: GET to `/v2/family`
  - Headers: Bearer token authentication
- **Get Devices**: GET to `/v2/device` and `/v2/group`
  - Fetches device list per home with full params

**WebSocket Connection** (`lib/connection/ws.js`)
- **Authentication**: Action `userOnline`
  - Payload: `{action: 'userOnline', apikey, appid, at, nonce, sequence, ts, version: 8}`
- **Device Update**: Action `update`
  - Payload: `{action: 'update', apikey, deviceid, params, sequence, ts: 0, userAgent: 'app'}`
  - Params vary by device type (see below)
- **Query State**: Action `query`
  - Payload: `{action: 'query', apikey, deviceid, params: [], sequence}`
- **Heartbeat**: Sends `'ping'` at intervals to keep connection alive

**LAN Connection** (`lib/connection/lan.js`)
- Uses mDNS discovery for `_ewelink._tcp.local` services
- **Encryption**: AES-128-CBC with MD5 hashed device key
- **Update Request**: POST to `http://{device_ip}:8081/zeroconf/{suffix}`
  - Suffixes: `switch`, `switches`, `dimmable`, `light`, `fan`, `transmit`, `location`, `monitor`
  - Encrypted payload with IV
  - Data structure: `{data, deviceid, encrypt: true, iv, selfApikey: '123', sequence}`
- **DNS Monitoring**: Listens for TXT records with encrypted device updates

**Common Device Parameters**
- **Single Switch**: `{switch: 'on'/'off'}`
- **Multi Switch**: `{switches: [{outlet: 0-3, switch: 'on'/'off'}]}`
- **SCM Devices**: Uses switches array even for single switch (UIID 77/78/81/107/112/138/160)
- **Dimmable**: `{brightness: 0-100, mode: 0}`
- **RGB Light**: `{ltype: 'color'/'white', color: {br, r, g, b}, white: {br, ct}}`
- **Power Monitor**: `{uiActive: 120}` to request power updates
- **Curtain/Motor**: `{location: 0-100}` for position
- **RF Bridge**: `{cmd: 'transmit', rfChl: channel}`
- **TH10/16**: `{switch, mainSwitch, deviceType: 'normal'}`
- **Fan (iFan)**: `{light: 'on'/'off', fan: 'on'/'off', speed: 1-3}`

**Update Priority**
1. Try LAN if device supports it (check `constants.devices.lan` array)
2. Fall back to WebSocket if LAN fails
3. Queue updates with 250ms intervals to prevent rate limiting
4. Power monitoring devices poll every 120 seconds

### State Management
- Device states cached using node-persist
- Queue system (p-queue) prevents API rate limiting
- Fakegato history service for Eve Home app integration

## Important Notes
- ES modules with Node.js 20/22/24 support required
- Uses @antfu/eslint-config for code style
- No test suite - manual testing required
- Verified Homebridge plugin following official standards
