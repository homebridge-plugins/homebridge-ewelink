export default {
  defaultConfig: {
    name: 'eWeLink',
    username: '',
    password: '',
    mode: 'auto',
    language: 'en',
    disableDeviceLogging: false,
    disableNoResponse: false,
    ignoredHomes: '',
    countryCode: '+44',
    httpHost: 'eu-apia.coolkit.cc',
    apiPort: 0,
    singleDevices: [],
    multiDevices: [],
    lightDevices: [],
    thDevices: [],
    fanDevices: [],
    sensorDevices: [],
    bridgeSensors: [],
    platform: 'eWeLink',
  },

  defaultValues: {
    adaptiveLightingShift: 0,
    apiPort: 0,
    brightnessStep: 1,
    curtainType: 'buttons',
    deviceType: 'button',
    httpHost: 'eu-apia.coolkit.cc',
    humidityOffset: 0,
    inUsePowerThreshold: 0,
    language: 'en',
    lowBattThreshold: 25,
    maxTarget: 30,
    minTarget: 10,
    mode: 'auto',
    offset: 0,
    operationTime: 100,
    operationTimeDown: 100,
    sensorTimeDifference: 60,
    sensorTimeLength: 60,
    sensorWebHook: '',
    showAs: 'default',
    showAsMotor: 'blind',
    targetTempThreshold: 0,
  },

  minValues: {
    adaptiveLightingShift: -1,
    apiPort: 0,
    brightnessStep: 1,
    inUsePowerThreshold: 0,
    lowBattThreshold: 5,
    maxTarget: 1,
    minTarget: 0,
    operationTime: 20,
    operationTimeDown: 20,
    sensorTimeDifference: 5,
    sensorTimeLength: 1,
    targetTempThreshold: 0,
  },

  appId: 'Uw83EKZFxdif7XFXEsrpduz5YyjP7nTl',

  appSecret: 'mXLOjea0woSMvK9gw7Fjsy7YlFO4iSu6',

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED'],

  allowed: {
    language: ['en', 'fr', 'th'],
    httpHosts: [
      'auto',
      'eu-apia.coolkit.cc',
      'us-apia.coolkit.cc',
      'as-apia.coolkit.cc',
      'cn-apia.coolkit.cn',
    ],
    mode: ['auto', 'wan', 'lan'],
    singleDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'showAs',
      'showAsMotor',
      'showAsEachen',
      'inUsePowerThreshold',
      'disableTimer',
      'temperatureSource',
      'isInched',
      'operationTime',
      'operationTimeDown',
      'sensorId',
      'hideSensor',
      'obstructId',
      'sensorType',
      'ipAddress',
    ],
    multiDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'showAs',
      'showAsMotor',
      'hideChannels',
      'inUsePowerThreshold',
      'disableTimer',
      'inchChannels',
      'sensorType',
      'operationTime',
      'operationTimeDown',
      'sensorId',
      'hideSensor',
      'obstructId',
      'ipAddress',
    ],
    lightDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'showAs',
      'brightnessStep',
      'adaptiveLightingShift',
      'offlineAsOff',
      'ipAddress',
    ],
    thDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'showAs',
      'showHeatCool',
      'hideSwitch',
      'offset',
      'offsetFactor',
      'humidityOffset',
      'humidityOffsetFactor',
      'targetTempThreshold',
      'minTarget',
      'maxTarget',
      'ipAddress',
    ],
    fanDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'hideLight',
      'ipAddress',
    ],
    sensorDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'deviceModel',
      'showAs',
      'lowBattThreshold',
      'offset',
      'offsetFactor',
      'humidityOffset',
      'humidityOffsetFactor',
      'hideLongDouble',
      'scaleBattery',
      'sensorTimeDifference',
    ],
    rfDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'resetOnStartup',
      'ipAddress',
    ],
    models: {
      singleDevices: ['single', 't', 'pow', 'iw', 's', 'micro', 'slampher', 'gddc5', 'king', 'zb'],
      multiDevices: ['dual_dualr2', 'dualr3_switch', 'dualr3_motor', '4ch', 't'],
      lightDevices: [
        'd1',
        'b1',
        'l1',
        'bulbB02BA60',
        'bulbB02FA60',
        'bulbB02FST64',
        'bulbB05BA60',
        'bulbB05BLA19',
        'king',
        'zl_d',
        'zl_dc',
      ],
      thDevices: ['th', 'panel', 'sc', 'hc'],
      fanDevices: ['ifan'],
      sensorDevices: ['dw', 'snzb01', 'snzb02', 'snzb03', 'snzb04', 'leak'],
      rfDevices: [],
    },
    sensorType: [
      'water',
      'smoke',
      'co',
      'co2',
      'contact',
      'occupancy',
      'motion',
      'p_button',
      'doorbell',
    ],
    showAs: [
      'audio',
      'blind',
      'box',
      'cooler',
      'default',
      'dehumidifier',
      'door',
      'doorbell',
      'fan',
      'garage',
      'garage_eachen',
      'garage_four',
      'garage_two',
      'gate',
      'heater',
      'humidifier',
      'lock',
      'outlet',
      'purifier',
      'p_button',
      'sensor',
      'sensor_leak',
      'stick',
      'switch_valve',
      'tap',
      'tap_two',
      'thermostat',
      'valve',
      'valve_two',
      'valve_four',
      'window',
    ],
    showAsMotor: ['blind', 'door', 'garage', 'window'],
    showAsEachen: ['garage', 'lock'],
    curtainType: ['buttons', 'blind', 'door', 'window'],
    deviceType: ['button', 'curtain', 'sensor'],
  },

  devices: {
    lan: [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      14,
      15,
      28,
      32,
      34,
      44,
      77,
      78,
      112,
      113,
      114,
      126,
      133,
      136,
      138,
      160,
      161,
      162,
      165,
      181,
      182,
      190,
      191,
      209,
      210,
      211,
      212,
    ],
    switchSingle: [1, 6, 14, 24, 27, 1009, 1256, 7004, 7005],
    switchSCM: [77, 78, 81, 107, 112, 138, 160, 191, 209],
    switchSCMPower: [182, 190],
    switchSinglePower: [5, 32],
    switchMulti: [
      2,
      3,
      4,
      7,
      8,
      9,
      29,
      30,
      31,
      41,
      82,
      83,
      84,
      113,
      114,
      139,
      140,
      141,
      161,
      162,
      210,
      211,
      212,
      2256,
      3256,
      4256,
    ],
    switchMultiPower: [126, 165],
    switchMate: [177],
    switchMan: [174],
    lightDimmer: [36, 44, 57],
    lightRGB: [22],
    lightCCT: [103],
    lightRGBCCT: [33, 59, 104, 135, 136, 137, 173],
    curtain: [11, 67],
    sensorContact: [102, 154],
    sensorAmbient: [15, 181],
    sensorTempHumi: [18],
    thermostat: [127],
    panel: [133, 195],
    fan: [34],
    humidifier: [19],
    diffuser: [25],
    camera: [87],
    rfBridge: [28, 98],
    zbBridge: [66, 128, 168, 243], // 128 not technically Zigbee, but same data structure
    zbSwitchStateless: [1000, 7000],
    zbLightDimmer: [1257],
    zbLightCCT: [1258],
    zbLightRGBCCT: [3258],
    zbMotor: [1514, 7006],
    zbSensorAmbient: [1770, 1771, 7014],
    zbSensorMotion: [2026, 7002],
    zbSensorOccupancy: [7016],
    zbSensorContact: [3026, 7003],
    zbSensorWater: [4026],
    zbSensorSmoke: [5026],
    zbThermostat: [7017],
    group: [5000],
    template: [130], // SPM sub unit
    cannotSupport: [0, 65, 118, 119, 120, 121],
    garageSensors: [102, 154, 3026],
    skipUpdateRequest: [1000],
  },

  paramsToKeep: [
    'actionTime',
    'actPow_',
    'battery',
    'bright',
    'brightness',
    'cctBrightness',
    'channel',
    'cmd',
    'color',
    'colorB',
    'colorG',
    'colorMode',
    'colorR',
    'colorTemp',
    'config',
    'curPercent',
    'current',
    'currentHumidity',
    'currentTemperature',
    'current_',
    'currLocation',
    'curTargetTemp',
    'fan',
    'hue',
    'human',
    'humidity',
    'key',
    'light',
    'lightbright',
    'lightswitch',
    'lightRcolor',
    'lightGcolor',
    'lightBcolor',
    'location',
    'lock',
    'ltype',
    'mainSwitch',
    'mode',
    'motion',
    'motorTurn',
    'openPercent',
    'online',
    'outlet',
    'per',
    'power',
    'op',
    'rfChl',
    'rfList',
    'rfTrig',
    'rgbBrightness',
    'saturation',
    'setclose',
    'smoke',
    'speed',
    'state',
    'switch',
    'switches',
    'targetTemp',
    'temperature',
    'tempScale',
    'trigTime',
    'type',
    'voltage',
    'voltage_',
    'water',
    'white',
    'workMode',
    'workState',
    'zyx_mode',
  ],

  // Ref: https://github.com/CoolKit-Technologies/eWeLink-API/blob/main/en/UIIDProtocol.md
  supportedDevices: {
    1: 1, // "SOCKET" (MINI, BASIC, S20, S26, S55, RF, RF_R2)
    2: 2, // "SOCKET_2"
    3: 3, // "SOCKET_3"
    4: 4, // "SOCKET_4"
    5: 1, // "SOCKET_POWER" (Sonoff Pow)
    6: 1, // "SWITCH" (T1 1C, TX1C, G1)
    7: 2, // "SWITCH_2" (T1 2C, TX2C)
    8: 3, // "SWITCH_3" (T1 3C, TX3C)
    9: 4, // "SWITCH_4"
    11: 1, // "CURTAIN" (King Q4 Cover)
    14: 1, // "SWITCH_CHANGE" (Sonoff SV)
    15: 1, // "THERMOSTAT" (TH10, TH16)
    18: 1, // "SENSORS_CENTER" (Sonoff SC)
    19: 1, // "HUMIDIFIER"
    22: 1, // "RGB_BALL_LIGHT" (B1, B1_R2)
    24: 1, // "GSM_SOCKET"
    25: 1, // "AROMATHERAPY" (Diffuser, Komeito 1515-X)
    27: 1, // "GSM_UNLIMIT_SOCKET"
    28: 1, // "RF_BRIDGE" (RFBridge, RF_Bridge)
    29: 2, // "GSM_SOCKET_2"
    30: 3, // "GSM_SOCKET_3"
    31: 4, // "GSM_SOCKET_4"
    32: 1, // "POWER_DETECTION_SOCKET" (Pow_R2, S31, IW101)
    33: 1, // "LIGHT_BELT",
    34: 4, // "FAN_LIGHT" (iFan02, iFan)
    36: 1, // "SINGLE_CHANNEL_DIMMER_SWITCH" (KING-M4)
    41: 4, // "CUN_YOU_DOOR"
    44: 1, // "SNOFF_LIGHT" (D1)
    57: 1, // "MONOCHROMATIC_BALL_LIGHT" (mosquito killer)
    59: 1, // "MUSIC_LIGHT_BELT" (L1)
    66: 1, // "ZIGBEE_MAIN_DEVICE"
    67: 1, // "RollingDoor"
    77: 4, // "SINGLE_SOCKET_MULTIPLE" (1 socket device using data structure of four)
    78: 4, // "SINGLE_SWITCH_MULTIPLE" (1 switch device using data structure of four
    81: 1, // "GSM_SOCKET_NO_FLOW" (1 socket device using data structure of four)
    82: 2, // "GSM_SOCKET_2_NO_FLOW"
    83: 3, // "GSM_SOCKET_3_NO_FLOW"
    84: 4, // "GSM_SOCKET_4_NO_FLOW"
    87: 1, // "EWELINK_IOT_CAMERA" (GK-200MP2B)
    98: 1, // "DOORBELL_RFBRIDGE"
    102: 1, // "DOOR_MAGNETIC" (OPL-DMA, DW2)
    103: 1, // "WOTEWODE_TEM_LIGHT" (B02-F)
    104: 1, // "WOTEWODE_RGB_TEM_LIGHT"
    107: 1, // "GSM_SOCKET_NO_FLOW"
    112: 1,
    113: 2,
    114: 3,
    126: 2, // "DUALR3"
    127: 1, // "GTTA127"
    128: 1, // SPM Main Unit (same data structure as zigbee bridge)
    130: 1, // SPM Sub Unit
    133: 1, // "NSPANEL"
    135: 1, // ""
    136: 1, // RGB Five-Color Light_Support 2.4G eWeLink-Remote
    137: 1, // "L2/SPIDER CONTROLLER"
    138: 1, // "MINIR3?" (WOOLLEY WLAN SMART SWITCH)
    139: 2, // "MINIR3?"
    140: 3, // "MINIR3?"
    141: 4, // "MINIR3?"
    154: 1, // DW2-Wi-Fi-L
    160: 1, // "SwitchMan Smart Wall Switch-M5 - 1 Gang"
    161: 2, // "SwitchMan Smart Wall Switch-M5 - 2 Gang"
    162: 3, // "SwitchMan Smart Wall Switch-M5 - 3 Gang"
    165: 2, // "DUALR3 Lite"
    168: 1, // Zigbee Bridge Pro
    173: 1, // Sonoff L3
    174: 1, // SwitchMan R5 - 6 Gang
    177: 1, // Switch Mate
    181: 1, // Sonoff TH Elite THR316 and THR320
    182: 1, // Power Detection Plug Overload Alarm-Multi-Channel Protocols (S40)
    190: 1, // POWR316 POWR316D POWR320D
    191: 1, // Like the above 190
    195: 1, // NSPANEL Pro
    209: 1, // Sonoff Ultimate Switch T5-1C-86
    210: 2, // Sonoff Ultimate Switch T5-2C-86
    211: 3, // Sonoff Ultimate Switch T5-3C-86
    212: 4, // Sonoff Ultimate Switch T5-4C-86
    243: 1, // Zigbee Bridge Ultra
    1000: 1, // "zigbee_ON_OFF_SWITCH_1000" (button device)
    1009: 1, // "" (Some sort of single switch device)
    1256: 1, // "ZIGBEE_SINGLE_SWITCH"
    1257: 1, // "ZigbeeWhiteLight"
    1258: 1,
    1514: 1, // Graywind Zigbee Shades
    1770: 1, // "ZIGBEE_TEMPERATURE_SENSOR"
    1771: 1, // "" some duplicate of the above https://github.com/homebridge-plugins/homebridge-ewelink/issues/494
    2026: 1, // "ZIGBEE_MOBILE_SENSOR"
    2256: 2, // "ZIGBEE_SWITCH_2"
    3026: 1, // "ZIGBEE_DOOR_AND_WINDOW_SENSOR"
    3256: 3, // "ZIGBEE_SWITCH_3"
    3258: 1, // "ZigbeeRGBLight"
    4026: 1, // "ZIGBEE_WATER_SENSOR"
    4256: 4, // "ZIGBEE_SWITCH_4"
    5000: 1, // Custom uiid for groups
    5026: 1, // Zigbee Smoke Sensor
    7000: 1, // Zigbee Button?
    7002: 1, // Zigbee Human Body Sensor_Support OTA
    7003: 1, // Zigbee Door Magnet_Support OTA
    7004: 1, // Zigbee Single-Channel Switch ­_Support OTA
    7005: 1, // Some switch, not entirely sure
    7006: 1, // Zigbee Curtain_Support OTA
    7014: 1, // some sensor https://github.com/homebridge-plugins/homebridge-ewelink/issues/494
    7016: 1, // https://sonoff.tech/product/gateway-and-sensors/snzb-06p/
    7017: 1, // https://github.com/homebridge-plugins/homebridge-ewelink/issues/518
  },

  cannotSupportDevices: {
    0: 0, // Placeholder for devices reported without a uiid (should be a never case)
    65: 0, // "CustomCamera" (eWeLink Camera App)
    118: 0, // "2.4G-1C" (eWeLink 2.4G Remote)
    119: 0, // "2.4G-2C" (eWeLink 2.4G Remote)
    120: 0, // "2.4G-3C" (eWeLink 2.4G Remote)
    121: 0, // "2.4G-6C" (eWeLink 2.4G Remote)
    147: 0, // NSPanel linked device (bulb) but no controls available
  },

  yetToSupportDevices: {
    10: 0, // "OSPF"
    12: 0, // "EW-RE"
    13: 0, // "FIREPLACE"
    16: 0, // "COLD_WARM_LED"
    17: 0, // "THREE_GEAR_FAN"
    23: 0, // "NEST_THERMOSTAT"
    26: 0, // "RuiMiTeWenKongQi"
    35: 0, // "EZVIZ_CAMERA",
    38: 0, // "HOME_KIT_BRIDGE",
    40: 0, // "FUJIN_OPS"
    42: 0, // "SMART_BEDSIDE_AND_NEW_RGB_BALL_LIGHT"
    43: 0, // "?"
    45: 0, // "DOWN_CEILING_LIGHT"
    46: 0, // "AIR_CLEANER"
    49: 0, // "MACHINE_BED"
    51: 0, // "COLD_WARM_DESK_LIGHT"
    52: 0, // "DOUBLE_COLOR_DEMO_LIGHT"
    53: 0, // "ELECTRIC_FAN_WITH_LAMP"
    55: 0, // "SWEEPING_ROBOT"
    56: 0, // "RGB_BALL_LIGHT_4"
    60: 0, // "NEW_HUMIDIFIER"
    61: 0, // "KAI_WEI_ROUTER"
    62: 0, // "MEARICAMERA"
    64: 0, // "HeatingTable"
    68: 0, // "KOOCHUWAH"
    69: 0, // "ATMOSPHERE_LAMP"
    76: 0, // "YI_GE_ER_LAMP"
    79: 0, // "CHRISTMAS_LIGHT"
    80: 0, // "HANYUAN_AIR_CONDITION"
    86: 0, // "CLEAR_BOOT"
    88: 0, // "YK_INFRARED"
    89: 0, // "SMART_OPEN_MACHINE"
    90: 0, // "GSM_RFBridge"
    91: 0, // "ROLLING_DOOR_91"
    93: 0, // "HTHD_AIR_CLEANER"
    94: 0, // "YIAN_ELECTRIC_PROTECT"
    109: 0, // "YK_INFRARED_2"
    1001: 0, // "BLADELESS_FAN"
    1002: 0, // "NEW_HUMIDIFIER"
    1003: 0, // "WARM_AIR_BLOWER"
  },
}
