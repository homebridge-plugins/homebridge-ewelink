<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-ewelink"><img alt="Homebridge Verified" src="https://user-images.githubusercontent.com/43026681/101325266-63126600-3863-11eb-9382-4a2924f0e540.png" width="600px"></a>
</p>
<span align="center">

## homebridge-ewelink

Homebridge plugin to integrate eWeLink devices into HomeKit

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-ewelink/latest?label=latest)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-ewelink)
[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-ewelink/beta?label=beta)](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Beta-Version)<br>
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![hoobs-certified](https://img.shields.io/badge/hoobs-certified-yellow)](https://plugins.hoobs.org/plugin/homebridge-ewelink)<br>
[![npm](https://img.shields.io/npm/dt/@homebridge-plugins/homebridge-ewelink)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-ewelink)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.com/channels/432663330281226270/742733745743855627)

</span>

### Plugin Information

- This plugin allows you to view and control your eWeLink devices within HomeKit. The plugin:
  - requires your eWeLink credentials to download a device list
  - attempts to control your supported devices locally, reverting to cloud control if necessary
  - listens for real-time device updates when controlled externally
  - supports removing your eWeLink credentials from the configuration in certain situations, see [wiki](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Connection-Methods#lan-mode-without-ewelink-credentials)

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v22` or `v24` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v1.6` or above - refer to link for more information and installation instructions.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Configuration)
- [Beta Version](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Beta-Version)
- [Node Version](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Node-Version)

### Features

- [Supported Devices](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Supported-Devices)
- [Accessory Simulations](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Accessory-Simulations)
- [Connection Methods](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Connection-Methods)
- [Internal API](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Internal-API)

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-ewelink/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-ewelink/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-ewelink/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To the original plugin maintainer: [@gbro115](https://github.com/gbro115).
- To successive contributors: [@MrTomAsh](https://github.com/MrTomAsh) and [@howanghk](https://github.com/howanghk) for [homebridge-ewelink-max](https://github.com/howanghk/homebridge-ewelink).
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.
- To the creators/contributors of [Fakegato](https://github.com/simont77/fakegato-history): [@simont77](https://github.com/simont77) and [@NorthernMan54](https://github.com/NorthernMan54).
- To the creator of the awesome plugin header logo: [Keryan Belahcene](https://www.instagram.com/keryan.me).
- To all users who have shared their devices to enable functionality.

### Disclaimer

- I am in no way affiliated with eWeLink nor any of the device brands (like Sonoff) and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
