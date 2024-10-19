# Change Log

All notable changes to homebridge-ewelink will be documented in this file.

This project tries to adhere to [Semantic Versioning](http://semver.org/). In practice, this means that the version number will be incremented based on the following:

- `MAJOR` version when a minimum supported version of `homebridge` or `node` is increased to a new major version, or when a breaking change is made to the plugin config
- `MINOR` version when a new device type is added, or when a new feature is added that is backwards-compatible
- `PATCH` version when backwards-compatible bug fixes are implemented

## 12.3.3 (2024-10-12)

### Changed

- added `homepage` to `package.json`
- updated dependencies

## 12.3.2 (2024-10-12)

### Changed

- Support node 22
- Bump `node` recommended versions to v18.20.4 or v20.18.0 or v22.9.0

### Fixed

- fixed cases where the plugin would crash when a device update fails

## 12.3.1 (2024-07-15)

### Changed

- Updated `eslint` and use new code style

### Fixed

- fix `hap-nodejs` api refs

## 12.3.0 (2024-07-13)

### Added

- Support for ZigBee Bridge Ultra with UIID `243`
- Support for Sonoff TX-4 Ultimate with UIID `212`

## 12.2.1 (2024-07-13)

### Changed

- Fixed for `hap-nodejs` v1.0.0
- Updated dependencies
- Bump `node` recommended versions to v18.20.4 or v20.15.1

## 12.2.0 (2024-03-27)

### Added

- Support for ZigBee occupancy sensor with UIID `7016`
- Support for ZigBee thermostat with UIID `7017`

### Changed

- Changed Rotation Speed characteristic for Fans from percentage to levels (#534) (@vadimpronin)
- Bump `node` recommended versions to v18.20.0 or v20.12.0
- Updated dependencies

### Fixed

- Fix UIID 182/190 power readings

## 12.1.0 (2023-12-16)

### Added

- Support for ZigBee button with UIID `7000`
- Support for ZigBee switch with UIID `7005`

### Changed

- Added plugin display name
- Don't overwrite the IP of a LAN device if it reports a different IP
- Bump `node` recommended versions to v18.19.0 or v20.10.0
- Updated dependencies

## 12.0.0 (2023-10-24)

### Added

- Support for ZigBee motor device with UIID `7006`
- Brightness and colour support for light device with UIID `173`

### Changed

- Updated dependencies
- Bump `node` supported versions to v18.18.2 or v20.8.1

### Removed

- Support for node 16

## 11.0.2 (2023-08-28)

⚠️ Note this will be the last version of the plugin to support Node 16.
- Node 16 moves to 'end of life' on 2023-09-11 ([more info](https://nodejs.org/en/blog/announcements/nodejs16-eol))
- This is in-line with the Homebridge guidelines on supporting node versions ([more info](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js/))
- If you are currently using Node 16, now is a good time to upgrade to Node 18 or 20 (see the link above for more info)

### Changed

- Update `axios` to `v1.5.0`

## 11.0.1 (2023-08-19)

### Changed

- Bump `node` recommended versions to v16.20.2 or v18.17.1 or v20.5.1
- Some code refactoring

## 11.0.0 (2023-07-24)

### Added

- Support for `B02-BL`
- Support for `SONOFF SNZB-02D`
- Support for devices with UIID `191` with LAN mode
- Support for devices with UIID `7014`

### Breaking

- Remove official support for Node 14
- Remove option to disable plugin - this is now available in the Homebridge UI
- Remove option for debug logging - this will be enabled when using a beta version of the plugin
- Remove individual accessory logging options to simplify the config

### Changed

- Bump `homebridge` recommended version to v1.6.0 or v2.0.0-beta
- Bump `node` recommended versions to v16.20.1 or v18.17.0 or v20.5.0
- Updated dependencies

## 10.4.0 (2023-01-07)

### Added

- Expose a Sonoff D1 or KING-M4 as a fan accessory type
- Improved support for SwitchMan devices (Sonoff R5)

### Changed

- Bump `axios` to v1.2.2
- Bump `homebridge` recommended version to v1.6.0 or v2.0.0-beta
- Bump `node` recommended versions to v14.21.2 or v16.19.0 or v18.13.0

### Fixed

- Power readings for POWR320 now show correctly

## 10.3.0 (2022-11-11)

### Added

- Support NSPanel Pro (as a temperature sensor) [UIID 195]

### Changed

- Bump `node` recommended versions to v14.21.1 or v16.18.1 or v18.12.1
- Bump `ws` to v8.11.0

## 10.2.0 (2022-10-09)

### Added

- Support devices with UIID 173 (Sonoff L3)
- Support devices with UIID 3258 (Zigbee RGBW light)
- Work-in-progress for devices with UUIDs:
  - 130 (SPM sub-unit)
  - 174 (SwitchMan devices)
  - 1514 (Zigbee motor controller)

### Changed

- Allow for node v18.10.0
- Update axios to `v1.1.2`

### Fixed

- Incorrectly exposing Sonoff M5 devices as programmable switches

## 10.1.0 (2022-09-25)

### Added

- Support devices with UUID 128 (SPM Main Unit)
- Support devices with UUID 154 (DW2-Wifi-L)
- Support devices with UUID 168 (Zigbee Bridge Pro)
- Support devices with UUID 190 (POWR316/POWR316D/POWR320D)
- Work-in-progress for devices with UUIDs:
  - 130 (SPM sub-unit)
  - 174 (SwitchMan devices)
  - 173 (Sonoff L3)
  - 1514 (Zigbee motor controller)
  - 3258 (Zigbee RGBW light)

### Changed

- Correct parameters for `updatePlatformAccessories()`
- Bump `node` recommended versions to v14.20.1 or v16.17.1
- Bump `ws` to v8.9.0
- Updated dev dependencies

## 10.0.0 (2022-07-08)

⚠️ After updating to this version:
  - Each time you start the plugin, you will be logged out the eWeLink app, and so I would recommend:
    - Creating a new eWeLink account, and sharing your devices to this new account
    - **Most importantly**, you should use your **main** account with the plugin, and login to the eWeLink app with your shared account

### Added

- Use a custom eWeLink APPID and APPSECRET if needed

### Changed

- Bump `node` recommended versions to v14.20.0 or v16.16.0

## 9.1.0 (2022-07-07)

⚠️ This update may remove some devices from your Homebridge instance. Unfortunately this is out my control. See [this link](https://github.com/homebridge-plugins/homebridge-ewelink/issues/385#issuecomment-1176457283).

### Added

- Support for Sonoff TH Elite

### Changed

- Bump `ws` to v8.8.0
- Updated dev dependencies

## 9.0.1 (2022-06-08)

### Changed

- Bump `node` recommended versions to v14.19.3 or v16.15.1

### Fixed

- A potential issue showing errors in the logs

## 9.0.0 (2022-05-29)

### Potentially Breaking Changes

⚠️ The minimum required version of Homebridge is now v1.4.0
⚠️ The minimum required version of Node is now v14

### Changed

- Changed to ESM package
- Bump `node` recommended versions to v14.19.3 or v16.15.0

## 8.15.0 (2022-05-02)

### Added

- **New Devices**
  - Sonoff S40
- **New Log Languages**
  - Thai (thanks [@tomzt](https://github.com/homebridge-plugins/homebridge-ewelink/pull/367))
- **Configuration**
  - `offlineAsOff` option for light devices - enable to show offline devices as 'off' in Homebridge/HomeKit

### Changed

- Bump `axios` to v0.27.2
- Bump `ws` to v8.6.0
- Bump `node` recommended versions to v14.19.1 or v16.15.0

## 8.14.0 (2022-04-17)

### Added

- **New Devices**
  - Sonoff B05-BL-A19 bulbs (UIID 136 devices) (also supports LAN mode)
  - Sonoff MINIR3 (UIID 138 devices) (also supports LAN mode)
  - Sonoff S-Mate (UIID 177 devices) as a Stateless Programmable Sensor

## 8.13.2 (2022-04-03)

### Changed

- Updated dependencies

## 8.13.1 (2022-03-20)

### Changed

- Bump `axios` to v0.26.1
- Bump `node` recommended versions to v14.19.1 or v16.14.2

## 8.13.0 (2022-02-23)

### Added

- Support DUALR3 Lite

### Changed

- Bump `axios` to v0.26.0

## 8.12.0 (2022-02-12)

### Added

- Option to disable the timer for irrigation valve simulations
- Power information to supported devices in internal API
- Target temperature threshold for TH-heater simulation, see #346

### Changed

- Bump `node` recommended versions to v14.19.0 or v16.14.0
- Bump `homebridge` recommended version to v1.4.0
- Bump `ws` to v8.5.0

## 8.11.2 (2022-01-23)

### Changed

- Bump `axios` to v0.25.0

### Fixed

- Fix LAN mode support for iFan04

## 8.11.1 (2022-01-15)

### Changed

- Bump `ws` to v8.4.2

### Fixed

- `undefined` log message on web socket error

## 8.11.0 (2022-01-13)

### Added

- Option to ignore eWeLink homes by ID (IDs will be displayed in the log when plugin starts)

### Changed

- Bump `node` recommended versions to v14.18.3 or v16.13.2
- Bump `ws` to v8.4.1

### Fixed

- Minor colour temperature issue for Mangotek RLD60C0E27 (UIID 33)

## 8.10.0 (2022-01-07)

### Added

- **New Devices**
  - Support for Mangotek RLD60C0E27 light (devices with UIID 33)
  - Support for Zigbee Smoke Sensors (devices with UIID 5026)

### Fixed

- Plugin crash for older versions of Homebridge

## 8.9.1 (2022-01-05)

### Changed

- Plugin will log HAPNodeJS version on startup
- Bump `homebridge` recommended version to v1.3.9

## 8.9.0 (2021-12-27)

### Added

- Option to show both 'Heat' and 'Cool' modes for the TH10/16 thermostat simulation

## 8.8.0 (2021-12-21)

### Added

- **New Devices**
  - Support for SwitchMan M5 (1/2/3 Gang)
  - Support for Sonoff NSPanel
- **Simulations**
  - Expose a single-channel device as a `Heater` or `Cooler` accessory type, using the current temperature value from another eWeLink, Govee or Meross sensor (Govee and Meross sensors will not work with HOOBS)
  - Current temperature values from sensors will be cached in the homebridge storage directory to allow my other plugins to create `Heater` and `Cooler` accessories with the temperature values
- **eWeLink Groups**
  - Expose eWeLink groups as HomeKit switches

### Changed

- Some config options rearranged for easier access
- Bump `ws` to v8.4.0

## 8.7.1 (2021-12-09)

### Fixed

- Show 'Hide Channels' and 'Inched Channels' in config schema form even when no 'Show As' is selected

## 8.7.0 (2021-12-08)

### Added

- Support Sonoff L2
- Expose a single or multi-channel generic switch as a `Audio Receiver`, `Set Top Box` or `Streaming Stick` HomeKit category types
  - The accessory will need to be published as an external accessory meaning it will need to be added separately to HomeKit
- Expose an Eachen GD-DC5 as a lock simulation

### Changed

- Bump `homebridge` recommended version to v1.3.8
- Bump `node` recommended versions to v14.18.2 or v16.13.1
- Bump `ws` to v8.3.0

### Fixed

- Potential uncaught errors updating subdevices of an RF bridge

## 8.6.0 (2021-11-18)

### Added

- The plugin will now retrieve devices from **all** your homes in your eWeLink account
- Expose an RF Bridge `curtain` device type as a HomeKit `WindowCovering`, `Door` or `Window` accessory simulation
- Expose a TH10/16 as a `Thermostat` device type

### Fixed

- An issue initialising a 2-Garage-Door simulation

## 8.5.0 (2021-11-03)

### Added

- Ability to use a contact sensor simulation to show the correct state of a garage door/lock simulation

## 8.4.2 (2021-10-31)

### Changed

- Bump `node` recommended versions to v14.18.1 or v16.13.0
- Bump `axios` to v0.24.0

## 8.4.1 (2021-10-20)

### Changed

- Some small changes to Fakegato debug logging

### Fixed

- An Eve app 'no data' gap for garage and contact sensor devices when restarting the plugin

## 8.4.0 (2021-10-16)

### Added

- Expose a single or multi-channel device as a gate type (shown as garage door)
  - If you use the Home app to open the door, it will then automatically close after a configured number of seconds

### Changed

- `disableNoResponse` will be set to `true` by the plugin when using in LAN mode
- Recommended node versions bumped to v14.18.1 or v16.11.1
- Recommended Homebridge bumped to v1.3.5
- Bump `axios` to v0.23.0

### Fixed

- An error when trying to unregister a hidden accessory from Homebridge

## 8.3.6 (2021-10-01)

### Changed

- Bump `ws` to v8.2.3

## 8.3.5 (2021-10-01)

### Changed

- Bump `axios` to v0.22.0

## 8.3.4 (2021-09-30)

### Changed

- Recommended node versions bumped to v14.18.0 or v16.10.0

## 8.3.3 (2021-09-14)

## Fixed

- Fixed an issue where an irrigation valve simulation would not turn off after the set time

## 8.3.2 (2021-09-09)

### Changed

- `configureAccessory` function simplified to reduce chance of accessory cache retrieval failing
- Bump `axios` to v0.21.4
- Bump `ws` to v8.2.2

## 8.3.1 (2021-09-05)

### Changed

- Recommended node version bumped to v14.17.6
- Bump `axios` to v0.21.3
- Bump `ws` to v8.2.1

## 8.3.0 (2021-08-26)

### Added

- Support for KingArt KING-Q1 garage door device
- Expose KingArt KING-Q4 device as a `Window` or `Door` HomeKit accessory type
- Custom Eve characteristic to invert status of inched switch without sending a command to device

### Changed

- 'Status By Inching' switches will no longer revert to 'off' when Homebridge is restarted

## 8.2.1 (2021-08-22)

### Changed

- Bump `ws` to v8.2.0

### Fixed

- An issue preventing DUALR3 from initialising
- Fix for uiid `112`

## 8.2.0 (2021-08-22)

### Added

- Support for UIIDs `138` `139` `140` `141`

## 8.1.0 (2021-08-17)

### Added

- `inchChannels` option for multi-channel switches and outlets (where the plugin will set on/off status based on inching)
- `language` option to have the plugin log in French, thanks to @jp-lno

## 8.0.2 (2021-08-12)

### Changed

- **Platform Versions**
  - Recommended node version bumped to v14.17.5

## 8.0.1 (2021-08-04)

### Changed

- Improved battery calculations for DW2 sensors

## 8.0.0 (2021-07-29)

### Important Note

- Your Accessory Simulations will stop working with this update if you have not re-set them up in the appropriate device configuration sections.
- **There is no longer a separate Accessory Simulations section**
- It is recommended to re-setup your simulations **before** updating to this version

### Added

- **Single Channel Devices**
  - Option to configure a single channel device to set its status based on device inching
- **DUALR3 Motor Mode**
  - Expose a DUALR3 in motor mode as a `GarageDoorOpener` accessory type
- **Temperature/Humidity Sensor Devices**
  - Option to offset recorded temperature or humidity by a scale factor
- **Configuration**
  - `disableNoResponse` setting to disable marking cloud-offline devices as 'No Response' in HomeKit
  - Plugin will now check for duplicate device ID entries in the config and ignore them

### Changed

- ⚠️ **Platform Versions**
  - Recommended node version bumped to v14.17.4
  - Recommended homebridge version bumped to v1.3.4
- ⚠️ **Accessories**
  - Plugin will now mark cloud-offline devices with 'No Response' by default
  - Plugin will now use HomeKit `Battery` service type instead of `BatteryService`
- **Backend**
  - Plugin will now reattempt initial HTTP connection on `ECONNABORTED` error

### Fixed

- Plugin will correctly update `StatusLowBattery` characteristic with `INT` instead of type `BOOL`

### Removed

- ⚠️ `offlineAsNoResponse` configuration setting - is now default - can be disabled with new `disableNoResponse` setting
- ⚠️ `ignoredDevices` configuration setting - now use the `ignoreDevice` option in the device type sections
- ⚠️ `groups` configuration setting - now use the `showAs` option in the device type sections

## 7.1.0 (2021-07-10)

### Added

- **New Devices**
  - Support for Zigbee multi-channel devices

### Changed

- **Homebridge UI**
  - `label` field now appears first in the device configuration sections
  - A device can now be ignored/removed from Homebridge by the `ignoreDevice` setting in the device configuration sections
- Bump `ws` dependency to v7.5.3

## 7.0.2 (2021-07-08)

### Changes

- Revert node version bump to v14.17.3 (back to v14.17.2)

### 7.0.1 (2021-07-08)

### Changes

- Device model in configuration will be validated

### Fixed

- An issue preventing garage doors and locks with a defined sensor from initialising

## 7.0.0 (2021-07-08)

### Important Notes

- This release includes breaking changes (denoted below with a ⚠️), so take note especially if:
  - You use the plugin in LAN-only mode,
  - You have Sonoff devices exposed as Outlet accessories, or
  - You use Accessory Simulations

### Added

- **LAN Mode (without eWeLink credentials)**
  - The plugin now supports removing eWeLink credentials from the config when in LAN mode. It is important to read about this feature before enabling it - [read more](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Connection-Methods#lan-mode-without-ewelink-credentials)
- **Homebridge UI**
  - Device-specific settings will show and hide depending on the new 'Device Model' (`deviceModel`) option
  - This showing/hiding of options will hopefully be available in the HOOBS UI soon
- **Accessory Logging**
  - `overrideLogging` setting per device type (to replace the removed `overrideDisabledLogging`), which can be set to (and will override the global device logging and debug logging settings):
    - `"default"` to follow the global device update and debug logging setting for this accessory (default if setting not set)
    - `"standard"` to enable device update logging but disable debug logging for this accessory
    - `"debug"` to enable device update and debug logging for this accessory
    - `"disable"` to disable device update and debug logging for this accessory
- **Startup Logging**
  - An accessory warning if a manually configured IP is different from the discovered IP
  - An accessory warning if a shared device is used over the cloud
  - An accessory warning if a cloud-device is reported offline
- **No Response Status**
  - Added a global setting `offlineAsNoResponse` to mark cloud-offline accessories as 'No Response' in HomeKit
- **Power Readings**
  - Power readings (via Eve app) now visible for accessories when exposed as `Switch`
- **DUALR3 Devices**
  - Support for LAN mode control for DUALR3 in motor mode
  - Power readings (via Eve app) available when in motor mode
  - Option to expose as a `WindowCovering`, `Window` or `Door` accessory type when in motor mode
- **iFan Devices**
  - Support for LAN mode and ability to specify a manual IP
- **TH10/16 Devices**
  - Support for LAN mode for all Accessory Simulations and ability to specify a manual IP
- **RF Bridge Devices**
  - Ability to change sensor type and other configurable options without the need to re-add the accessory
  - Configuration option `resetOnStartup` to reset the subdevices, useful when adding/removing subdevices to the bridge
  - Added option to specify a manual IP for an RF Bridge
  - Added option to expose an RF sensor device as a `Doorbell` accessory type
  - Added option to expose an RF sensor device as a `StatelessProgrammableSwitch` accessory type
- **Light Devices**
  - Remove Adaptive Lighting feature from a device by setting the `adaptiveLightingShift` to `-1`
- **Zigbee Button Devices**
  - Comparison of trigger time against notification time to reduce duplicate accessory updates
  - Will no longer request current state when coming back online to reduce duplicate accessory updates
- **Zigbee Switch Devices**
  - Option to expose as an `Outlet`
- **Humidity Sensor Devices**
  - Config option to offset the recorded humidity (%RH) for devices that report this
- **Accessory Simulations**
  - Expose a generic single/multi-channel device as a `Doorbell` accessory
  - Expose a generic single/multi-channel device as a `StatelessProgrammableSwitch` accessory
  - Added the option of using a DW2 or Zigbee contact sensor to determine _Locked_ and _Unlocked_ state for lock simulation
  - Power readings (via Eve app) visible for simulations when using a DUALR3 device
- **New Devices**
  - Support for Zigbee leak sensors
  - Support for device with eWeLink UIID 67 _RollingDoor_

### Changed

- **LAN Mode**
  - ⚠️ If you have the plugin in `lan`-only mode then the plugin will remove any accessories that do not support LAN mode
- **Configuration**
  - ⚠️ The 'Outlet Devices' (`outletDevices[]`) section has been removed from the configuration - you will need to reconfigured these devices within the 'Single Devices' (`singleDevices[]`) section
- **Accessory Simulations**
  - ⚠️ The 'Accessory Simulations' (`groups[]`) section will be removed in a future plugin version - you should now setup your simulations from within the appropriate device type section using the 'Show As' setting
    - Simulations for TH10/16, DW2 and `doorbell`, `p_button` & `sensor` will need to be recreated immediately
    - Garage door, window blind, door, window, valve, tap, lock and switch-valve simulations will continue to work for now but will need to be recreated at some point in the future
  - ⚠️ Eachen GD-DC5 devices no longer need to be setup as a simulation if this deviceModel is chosen in the configuration
- **Outlet Devices**
  - ⚠️ Will now be exposed by default as `Switch`, use the 'Show As' setting to change back to `Outlet` if needed
- **Homebridge UI**
  - More interactive - device configuration will expand once device ID and model entered
  - Device configuration options will now hide/show based on the `deviceModel` field
- **Startup Logging**
  - Accessory configuration options will be logged regardless of logging level
- **iFan Devices**
  - Previous fan speed will be used again after turning off and on
- **Polling**
  - Polling for power/temperature/humidity readings increased to two minutes
  - Polling for power/temperature/humidity readings will be skipped if device is marked as offline
- **Configuration**
  - `sensorTimeDifference` minimum reduced to 5 seconds and default reduced to 60 seconds
- **Dependencies**
  - Recommended node version bump to v14.17.3
  - Bump `ws` dependency to v7.5.2

### Fixed

- An issue preventing controlling a garage door simulation when using a sensor
- An issue with the DUALR3 in motor mode hanging on 'Closing...' or 'Opening...'
- Fixed the multiple notifications when closing an Eachen device garage door
- A `RangeError` error which caused HOOBS bridge to restart

### Removed

- `overrideDisabledLogging` setting for each accessory type
- `outletDevices[]` configuration section
- `switchDevices[].showAsOutlet` removed - use `switchDevices[].showAs` instead
- `ContactSensorState` and other unneeded characteristics from garage (simulation) services

## 6.8.0 (2021-06-14)

### Added

- **Accessory Simulations**
  - Expose a single/multi channel device as any type of sensor
  - Expose a single/multi channel device an _Air Purifier_
  - Expose a TH10/16 device as a _Cooler_
  - Expose a TH10/16 device as a _Humidifier_
  - Expose a TH10/16 device as a _Dehumidfier_
- **LAN Mode**
  - Enabled for TH10/16 (requires firmware 3.5.0)
- **Plugin UI**
  - Show MAC address of accessory in plugin-ui

### Changed

- TH10/16 simulation accessory type change from _Thermostat_ to _Heater_

### Removed

- Remove `setup` config option for simulations as device type is now automatically determined

### Fixed

- Fix a logging issue for the zigbee contact sensor

## 6.7.1 (2021-05-27)

### Fixed

- Fixes an issue with sensors with a garage simulation
- Fixes an issue with TH10/16 devices with web socket timeouts

## 6.7.0 (2021-05-26)

### Added

- Hide a contact sensor from HomeKit when used with a garage door simulation
- Support devices with eWeLink UIID 112, 113, 114

### Changed

- Avoid repeated battery logging for the Sonoff DW2
- iFan logging modifications
- Throw an error when controlling a device when the web socket is closed (avoid queuing updates)
- Recommended node version bump to v14.17.0
- Bump `ws` dependency to v7.4.6
- Use `standard-prettier` code formatting

### Fixed

- Fix internal API auth issue when using a base64 encoded password

## 6.6.0 (2021-05-10)

### Added

- Log internal API requests when in debug mode
- Support querying temperature and humidity values via the internal API

### Changed

- Display temperature and humidity units for the zigbee temperature/humidity sensor in the logs
- Reduce the 'No Response' timeout to 2 seconds
- Update the correct corresponding characteristic after the 'No Response' timeout
- Ensure user is using at least Homebridge v1.3.0
- Update homebridge-ui wiki links to match github readme file

### Removed

- Removed `encodedPassword` and `language` config options
  - The plugin will now initially try the supplied password and if incorrect will attempt another login with a base64 decoded version
- Language option unnecessary until if and when other languages are available

### Fixed

- Fixes an issue where the web socket would not close on plugin shutdown

## 6.5.1 (2021-05-07)

### Changed

- Amendments to internal API endpoints
- Device IP changes will now reflect correctly

### Fixed

- Fixes an initialisation issue with the 'garage' and 'obstruction detection' switch simulations

## 6.5.0 (2021-05-06)

### Added

- Internal HTTP API to query/control the state of certain homebridge-ewelink accessories
  - Options for new configuration setting `apiPort` are:
    - `0` to disable the API (default setting)
    - `1` to enable the API with a random available port (port will be shown in the log)
    - Any higher integer to enable the API on this fixed port
  - Documentation for the API can be seen at the base url (Homebridge IP + API port)

## 6.4.0 (2021-05-04)

### Added

- Power, voltage and current readings for DUALR3 when exposed as outlets
- RF Bridge remote buttons will turn on for 3 seconds in HomeKit when pressed
- Link a Zigbee contact sensor to a single garage door to report the garage door state
- Set a temperature offset for the Zigbee temperature/humidity sensor
- Configuration options to manually set account http host and country code [#249](https://github.com/homebridge-plugins/homebridge-ewelink/pull/249)

### Changed

- Change Sonoff POWR2/S31 polling interval to a fixed 60 seconds
- iFan speed will now log as {low, medium, high}
- Remove 'Outlet In Use' characteristics for outlets that don't support power readings
- Remove Eve power characteristics for outlets that don't support power readings
- More language strings added to separate language file
- Accessory 'identify' function will now add an entry to the log
- Backend refactoring, function and variable name changes

## 6.3.0 (2021-04-28)

### Added

- Support DUALR3 motor mode (as a _WindowCovering_ service)

### Changed

- Remove old _Switch_ services from DUALR3 when in motor mode
- iFan devices now use caching to avoid unnecessary duplicate updates
- Increase ws timeout from 5 to 6 seconds
- Decrease lan-only timeout from 10 to 9 seconds

## 6.2.2 (2021-04-27)

### Changed

- Adjust iFan speed thresholds (now 0% is off, 1-33% is low, 34-66% is medium and 67-100% is high)
- Changed commands for multi-channel devices to only update desired channel (not all channels)
- Pause Adaptive Lighting if device is offline
- Automatically retry eWeLink login on startup in case of certain error codes
- Update package description (remove 'with original firmware' as this is redundant for eWeLink devices)

## 6.2.1 (2021-04-18)

### Changed

- Trim new lines and spaces from password when decoded from base64
- Updated dependencies (`ws`)

## 6.2.0 (2021-04-16)

### Added

- LAN mode for Sonoff RF Bridge

### Changed

- More compact logging for eWeLink 504 error
- Recover accessories from the cache using the UUID
- Reduce WS timeout to 5 seconds to reduce cases of `was slow to respond` HB warning
- Update wiki links in the Homebridge plugin-ui

### Removed

- Remove online/offline status for Zigbee sensor devices

### Fixed

- Fix characteristic NaN warning for `LastActivation`

## 6.1.2 (2021-04-14)

### Fixed

- Remove any existing humidity sensor for TH10/16 if DS18B20 sensor is used

## 6.1.1 (2021-04-13)

### Fixed

- Fixed an unhandled rejection error when controlling certain CCT bulbs

## 6.1.0 (2021-04-12)

### Added

- Support for doorbell model SA-026 (can be exposed as any sensor type as per other RF sensors)
- Updated plugin-ui 'Support' page links to match GitHub readme file

### Changed

- Improvements to RF Bridge:
  - No more characteristic warnings for `LastActivation` for motion and contact sensors
  - Removed logs for 'not triggered' if device has since been triggered again

## 6.0.3 (2021-04-08)

### Fixed

- Revert 'No Response' messages for **DW2** devices as they go on and offline
- Fixed the interval time length for calculating total energy consumption for relevant devices

## 6.0.2 (2021-04-07)

### Changed

- Revert 'No Response' messages for **DW2** devices as they go on and offline

## 6.0.1 (2021-04-07)

### Requirements

- **Homebridge Users**

  - This plugin has a minimum requirement of Homebridge v1.3.3

- **HOOBS Users**
  - This plugin has a minimum requirement of HOOBS v3.3.4

### Changed

- 'No Response' messages for **Zigbee and DW2** devices as they go on and offline
- 'No Response' messages for **all devices** if controlled and unsuccessful (and this status will be reverted after 5 seconds)
- Use the new `.onGet`/`.onSet` methods available in Homebridge v1.3
- Updated README to reflect minimum supported Homebridge/HOOBS and Node versions
- Updated recommended Node to v14.16.1

### Fixed

- Fixes a caching issue with the iFan accessory

## 5.6.0 (2021-03-25)

### Added

- Enter your eWeLink password as a base64 encoded string and use the option `encodedPassword` to let the plugin know ([#223](https://github.com/homebridge-plugins/homebridge-ewelink/issues/223))
- Support for zigbee colour temperature lights (ewelink uiid 1258) ([#222](https://github.com/homebridge-plugins/homebridge-ewelink/issues/222)), including:
  - Ikea Tradfri E14 600 lumen

### Changed

- Improvements to web socket connection: ([#224](https://github.com/homebridge-plugins/homebridge-ewelink/issues/224))
  - On startup, the plugin will wait to connect to the web socket before initialising devices
  - A new web socket address will be requested if the provided address causes errors
  - In particular this should fix the `ENOTFOUND as-pconnect4.coolkit.cc` error that some users in the Asia continent were receiving

## 5.5.1 (2021-03-21)

### Changed

- Remove the custom `minValue` for `CurrentTemperature` characteristic
- More welcome messages
- Updated `plugin-ui-utils` dependency

## 5.5.0 (2021-03-17)

### Added

- Enable LAN control for the Sonoff SV
- Log entries will show for 'uncontrollable' devices if `mode:lan` on plugin startup
- Log entries to highlight unnecessary top-level configuration options you may have set
- Added a note in the plugin settings about changing RF bridge sensors and its consequences

### Changed

- Remove country code configuration option as the plugin can determine your region automatically
- Modified config schema to show titles/descriptions for non Homebridge UI users
- Automatically show useful info in logs for 'yet to implement' devices
- Updated links on plugin-ui to match GitHub wiki
- [backend] Eve characteristics abstracted into separate file for better efficiency

## 5.4.0 (2021-03-14)

### Added

- The plugin now differentiates between LAN support for **incoming** and **outgoing** updates, allowing incoming updates for:
  - TH10/16
  - B02 and B05 bulbs

### Fixed

- Attempt to fix outlet polling updates so the device reports updated info rather than the previous info.

## 5.3.0 (2021-03-10)

### Added

- Set up a polling interval for outlet devices to obtain power information on a regular basis (useful when the device doesn't automatically send frequent updates)

### Changed

- Adaptive Lighting now requires Homebridge 1.3 release
- Garages no longer need 'dummy' contact sensor to view Eve history
  - For this reason, the `exposeContactSensor` setting is now redundant and so has been removed
- Outlet intervals for energy calculation and updates will stop on Homebridge shutdown

## 5.2.0 (2021-03-08)

### Added

- **Accessory Simulations**
  - Expose an optional contact sensor for Eachen garage devices for historical data in the Eve app
  - Set custom minimum/maximum target temperatures for the TH10/16 thermostat simulation

### Changed

- Specify a custom IP for the Sonoff D1
- Show full error stack on plugin disable in debug mode
- Updated dependencies

### Fixed

- Fixes a `multiple callback` error with CCT bulb accessories

## 5.1.1 (2021-03-02)

### Fixed

- Fixes an issue sending LAN updates to multi-channel devices

## 5.1.0 (2021-03-02)

### Added

- **Accessory Simulations**
  - Added `Door` service type simulation
  - Added `Window` service type simulation
  - [experimental] Specify different operation time for UP and DOWN for garages, blinds, doors and windows
- **Accessories**
  - Support for Sonoff DUALR3
  - Support for Konesky Mosquito Killer
  - Support for Sonoff SC (Sensor Centre)
  - [experimental] Support for Sonoff D1 LAN control

### Changed

- Less strict threshold for determining a 'significant' colour change for disabling Adaptive Lighting

## 5.0.6 (2021-02-26)

### Fixed

- Removes the extra _Switch_ service that was accidentally added to certain bulbs

## 5.0.5 (2021-02-25)

### Changed

- Reverse the polarity of the leak sensor simulation
  - You can expose a DW2 sensor as a leak sensor using [this guide](https://www.youtube.com/watch?v=YFu2LZfrrqs) as an Accessory Simulation

## 5.0.4 (2021-02-24)

### Changed

- Plugin will check that certain Accessory Simulations have been setup with the device type
- Hide IP address field in plugin settings if plugin `mode` is set to `wan`

## 5.0.3 (2021-02-24)

### Changed

- Remove old _Switch_ services when setting up Accessory Simulations
- Add the type of Accessory Simulation to the logged options on restart

## 5.0.2 (2021-02-24)

### Fixed

- Fixes an issue initialising Accessory Simulation Lock devices

## 5.0.1 (2021-02-24)

### Fixed

- Fixes an issue initialising Contact Sensor devices

## 5.0.0 (2021-02-24)

- ⚠️ This release includes an overhaul of the settings in particular to specific device configuration
- The following options have been replaced:
  - `hideChanFromHB`, `switchAsOutlet`, `outletAsSwitch`, `inUsePowerThreshold`, `hideLightFromFan`, `hideSwitchFromTH`, `thAsThermostat`, `resetRFBridge`, `lowBattThreshold`, `sensorTimeDifference`, `bulbB02BA60`, `bulbB02FST64`, `thTempOffset`, `hideZBLDPress`, `ZBDWBatt`, `ipOverride`
- If you use any of the above options then please take some time to review the changes after updating the plugin
- Detailed information about the changes can be seen [here](https://gist.github.com/bwp91/e87d9d3eb0e5dbc08e9ae7b31e33366e)

### Added

- **Configuration**
  - The ability to explicitly enable device logging per device if you have `disableDeviceLogging` set to true
  - A `label` setting per device group which has no effect except to help identify the device when editing the configuration
  - New `brightnessStep` option to specify a minimum brightness step in the Home app per dimmer/bulb/LED strip
  - New `adaptiveLightingShift` option to offset the Adaptive Lighting values per bulb
  - `showAsOutlet` option extended multi-channel switch and light switch devices to expose them as outlets
- **Accessories**
  - Enhanced Eve information available for contact sensors:
    - DW2
    - Zigbee Contact Sensor
- **Accessory Simulations**
  - Expose a DW2 contact sensor as a leak sensor
  - Sub-accessories will be removed automatically when setting up a new Accessory Simulation
- **Homebridge Plugin UI**
  - 'My Devices' shows a red/green icon on the to show device WAN/LAN reachability
  - 'My Devices' shows the firmware version for your device
- **New Devices**
  - Support for eWeLink switch uiid 81, 82, 83, 84 and 107 device types
  - Support for the 'Sonoff Hum' humidifier device (on/off and mode)

### Changed

- New plugin configuration format - [more info](https://gist.github.com/bwp91/e87d9d3eb0e5dbc08e9ae7b31e33366e)
- Device firmware version will now show correctly in HomeKit apps
- Information about error 406 added to the logs in the form of a link (shown when error is received)
- Updated minimum Node to v14.16.0

### Fixed

- Fixes a characteristic warning for _MotionDetected_ for Zigbee Motion Sensors

## 4.7.6 (2021-02-17)

### Fixed

- Fixes an issue with the DW2 detecting garage door states

## 4.7.5 (2021-02-15)

### Changed

- Fixes an issue with the DW2 detecting garage door states

## 4.7.4 (2021-02-15)

### Fixed

- Fixes an issue when using custom RF sensors

## 4.7.3 (2021-02-13)

### Changed

- Hide WS messages that have no useful information about a device
- Thermostat accessory simulation will now setup after a small delay to let the accessory initialise first
- Thermostat device will now suggest changing temperature scale from F to C in the eWeLink app
- Changes to colour conversion:
  - Lighter colours appear brighter
  - Solid red is now easier to obtain via the Home app

## 4.7.2 (2021-02-12)

### Fixed

- Fixes a bug where config items separated by a comma weren't adhered to properly
- Stop subsequent warning messages if a device fails to initialise

## 4.7.1 (2021-02-11)

### Changed

- The 'auto' and 'cool' modes will now be hidden for thermostat devices in the Eve app
- Added a 10 second timeout when sending web socket messages
- Updated dependencies:
  - `websocket-as-promised` to v2.0.1
- Fakegato library formatting and simplification

### Fixed

- Fixed a bug when initialising lock accessory simulations

## 4.7.0 (2021-02-10)

### Added

- Support for the [eWeLink thermostat](https://ewelinkcommunity.net/device-lists/heating/kkmoon-hc-t010-ewf/) device type
- A queue for device updates to improve reliability, this also results in:
  - Faster device updates for colour bulbs and diffusers
- Configuration checks to highlight in the logs any unnecessary or incorrectly formatted settings you have
- Added a note in the plugin UI when adding an Accessory Simulation that the accessory will need to be removed from the cache
- Links to 'Configuration' and 'Uninstall' wiki pages in the plugin-ui

### Changed

- ⚠️ `ignoredDevices` configuration option is now an array not a string - [see details](https://gist.github.com/bwp91/90db67d578a8206c5a98a3447839f9e5)
- Reinstated `ipOverride` into the Homebridge plugin UI screen
- Improved colour temperature conversion for L1 and L1 Lite devices
- HTTP error codes will be displayed in the logs if and when the plugin re-attempts the connection
- Error messages refactored to show the most useful information
- [Backend] Major code refactoring
- [Backend] Code comments
- Updated minimum Node to v14.15.5
- Updated minimum Homebridge to v1.1.7
- Updated dependencies

### Removed

- Removed `nameOverride` configuration option - the plugin can now obtain channel names from eWeLink
- Removed `resetRFBridge` option - the same usage can be achieved with `ignoredDevices`

### Fixed

- Fixed a bug where Adaptive Lighting would not be disabled if the colour was changed from the eWeLink app
- Fixed an issue with the 'Lock' Accessory Simulation where the status would never update as 'Unlocked'

## 4.6.1 (2021-02-02)

### Changed

- Extra debug logging for WS reconnection status
- Updated `ws` dependency to v7.4.3

## 4.6.0 (2021-01-30)

### Added

- **[Experimental]** Use a TH10/16 device as a thermostat using an Accessory Simulation [more info](https://github.com/homebridge-plugins/homebridge-ewelink/issues/161#issuecomment-770230157)
- Support for the Zigbee type white bulb

### Changed

- Updated plugin-ui-utils dep and use new method to get cached accessories
- Increase the timeout for LAN control to 10 seconds for LAN only settings
- Show LAN update errors in the log

## 4.5.1 (2021-01-28)

### Changed

- Set the switch as the primary service of a TH10/16 device
- Only show the line in error logs if it exists (no more `[line undefined]`)

### Fixed

- Fixes an issue where RF sensors would not use a custom defined type (again!)

## 4.5.0 (2021-01-28)

### Added

- Use a switch to control the `Obstruction Detected` feature of a garage door

### Changed

- More consistent and clearer error logging

### Fixed

- Fix for TH10/16 devices when the HomeKit switch would show the state of 'auto' mode
- Fix for TH10/16 devices (shown as thermostat) where the plugin would not show the current state of the device
- Fix for the display of watts/amps/volts for outlets that support this

## 4.4.5 (2021-01-24)

### Fixed

- Fix where the battery for DW2 device would not update

## 4.4.4 (2021-01-24)

### Changed

- Backend - better handling of errors

## 4.4.3 (2021-01-20)

### Fixed

- Fixes an issue where RF sensors would not use a custom defined type

## 4.4.2 (2021-01-20)

### Changed

- Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46

### Fixed

- Fixes an issue when adding new RF bridge devices

## 4.4.1 (2021-01-20)

### Changed

- Fakegato logging disabled in Homebridge `debug` mode, can be explicitly enabled with `debugFakegato`

## 4.4.0 (2021-01-14)

### Added

- Single Accessory Simulations for multi-channel devices (e.g. 1 valve using a Sonoff 4CH)
- `operationTime` for Accessory Simulations will now be validated and increased to 20 if less than 20 or an invalid number

### Changed

- ⚠️ **Accessory Simulations** - if use '1 Lock', '1 Tap/Faucet' or '1 Valve' you will need to update your configuration with the Device Setup field (via Homebridge UI) or adding the line `"setup": "oneSwitch"` directly to your configuration file in the groups section
- Changes to plugin now in CHANGELOG.md

### Removed

- Removed `Obstruction Detected` tests

## 4.3.0 (2021-01-12)

### Added

- New Accessory Simulations:
  - 2 Taps/Faucets using a multi-channel device
  - 4 Irrigation Valves using a multi-channel device #182
- New `disableDeviceLogging` config option to hide device state logging #183

### Changed

- `hideDevFromHB` config option renamed to `ignoredDevices`
- Minimum `operationTime` for associated Accessory Simulations increased to 20 (2 seconds)
- Removal of maximum values on plugin settings screen for all `number` types
- Changes to startup log messages
- Adaptive lighting minimum Homebridge beta version is now beta-42
- Backend code changes
- Updated dependencies
