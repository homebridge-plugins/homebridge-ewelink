import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

export default class {
    constructor(platform, accessory) {
        this.hapChar = platform.api.hap.Characteristic;
        this.hapServ = platform.api.hap.Service;
        this.log = platform.log;
        this.platform = platform;
        this.lang = platform.lang;
        this.name = accessory.displayName;
        this.accessory = accessory;

        // Set up custom variables for this device type
        const deviceConf = platform.deviceConf[accessory.context.eweDeviceId] || {};
        this.enableLogging = !platform.config.disableDeviceLogging;

        // Initialize cache state
        this.cacheState = false;

        // Set up the Switch Service for HomeKit
        this.service = this.accessory.getService(this.hapServ.Switch)
            || this.accessory.addService(this.hapServ.Switch);

        // Set up event handlers for On characteristic
        this.service.getCharacteristic(this.hapChar.On)
            .onSet(this.setOn.bind(this));

        this.log('[%s] initialized as a Zigbee Smart Water Valve.', this.name);
    }

    async externalUpdate(params) {
        try {
            // Handle On/Off state
            if (hasProperty(params, 'switch')) {
                const newState = params.switch ? true : false;
                if (newState !== this.cacheState) {
                    this.cacheState = newState;
                    this.service.updateCharacteristic(this.hapChar.On, newState);
                    if (params.updateSource && this.enableLogging) {
                        this.log('[%s] State updated to [%s]', this.name, newState ? 'On' : 'Off');
                    }
                }
            }
        } catch (err) {
            this.platform.deviceUpdateError(this.accessory, err, false);
        }
    }

    async setOn(value) {
        try {
            const newState = value ? true : false;
            if (this.enableLogging) {
                this.log('[%s] Setting state to [%s]', this.name, newState ? 'On' : 'Off');
            }

            // Send command to the device
            await this.platform.sendDeviceUpdate(this.accessory, {
                switch: newState,
            });
            
            // Update cache after successful command
            this.cacheState = newState;
        } catch (err) {
            // Revert the characteristic state on error
            this.service.updateCharacteristic(this.hapChar.On, this.cacheState);
            this.platform.deviceUpdateError(this.accessory, err, false);
            throw err;
        }
    }
}