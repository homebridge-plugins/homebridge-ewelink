import platformConsts from '../../utils/constants.js'
import { hasProperty } from '../../utils/functions.js'

export default class {
    constructor(platform, accessory) {
        this.hapChar = platform.api.hap.Characteristic;
        this.hapServ = platform.api.hap.Service;
        this.hapErr = platform.api.hap.HapStatusError;
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

        // Set up the Valve Service for HomeKit
        this.service = this.accessory.getService(this.hapServ.Valve)
        if (!this.service) {
            this.service = this.accessory.addService(this.hapServ.Valve);
            this.service.updateCharacteristic(this.hapChar.Active, 0);
            this.service.updateCharacteristic(this.hapChar.InUse, 0);
            this.service.updateCharacteristic(this.hapChar.ValveType, 1); // 1 = Irrigation
            this.service.updateCharacteristic(this.hapChar.SetDuration, 360); // Default 10 minutes
            this.service.addCharacteristic(this.hapChar.RemainingDuration);
        }

        // Set up event handlers for Active characteristic
        this.service
            .getCharacteristic(this.hapChar.Active)
            .onSet(async value => {
                try {
                    const newState = value === 1;
                    if (this.enableLogging) {
                        this.log('[%s] Setting valve to [%s]', this.name, newState ? 'On' : 'Off');
                    }

                    // Send command to the device
                    await this.platform.sendDeviceUpdate(this.accessory, {
                        switch: newState
                    });

                    // Update InUse characteristic to match Active
                    this.service.updateCharacteristic(this.hapChar.InUse, value);

                    if (value === 1) {
                        // If turning on, start the timer
                        const duration = this.service.getCharacteristic(this.hapChar.SetDuration).value;
                        this.service.updateCharacteristic(this.hapChar.RemainingDuration, duration);
                        
                        // Clear any existing timer
                        if (this.timer) {
                            clearTimeout(this.timer);
                        }
                        
                        // Set new timer
                        this.timer = setTimeout(() => {
                            this.service.updateCharacteristic(this.hapChar.Active, 0);
                            this.service.updateCharacteristic(this.hapChar.InUse, 0);
                            this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
                        }, duration * 1000);
                    } else {
                        // If turning off, clear the timer and reset remaining duration
                        if (this.timer) {
                            clearTimeout(this.timer);
                        }
                        this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
                    }
                    
                    // Update cache after successful command
                    this.cacheState = newState;
                } catch (err) {
                    // Revert the characteristic state on error
                    this.service.updateCharacteristic(this.hapChar.Active, this.cacheState);
                    this.service.updateCharacteristic(this.hapChar.InUse, this.cacheState);
                    this.platform.deviceUpdateError(this.accessory, err, false);
                    throw new this.hapErr(-70402);
                }
            });

        // Set up handler for SetDuration characteristic
        this.service.getCharacteristic(this.hapChar.SetDuration)
            .onSet(value => {
                if (this.service.getCharacteristic(this.hapChar.InUse).value === 1) {
                    // Update the remaining duration if valve is currently active
                    this.service.updateCharacteristic(this.hapChar.RemainingDuration, value);
                    
                    // Reset the timer with new duration
                    if (this.timer) {
                        clearTimeout(this.timer);
                    }
                    this.timer = setTimeout(() => {
                        this.service.updateCharacteristic(this.hapChar.Active, 0);
                        this.service.updateCharacteristic(this.hapChar.InUse, 0);
                        this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
                    }, value * 1000);
                }
            });

        this.log('[%s] initialized as a Zigbee Smart Water Valve.', this.name);
    }

    async externalUpdate(params) {
        try {
            // Handle On/Off state
            if (hasProperty(params, 'switch')) {
                const newState = params.switch ? true : false;
                if (newState !== this.cacheState) {
                    this.cacheState = newState;
                    const value = newState ? 1 : 0;
                    this.service.updateCharacteristic(this.hapChar.Active, value);
                    this.service.updateCharacteristic(this.hapChar.InUse, value);
                    
                    if (!newState) {
                        // If turned off externally, clear timer and reset remaining duration
                        if (this.timer) {
                            clearTimeout(this.timer);
                        }
                        this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
                    }
                    
                    if (params.updateSource && this.enableLogging) {
                        this.log('[%s] Valve state updated to [%s]', this.name, newState ? 'On' : 'Off');
                    }
                }
            }
        } catch (err) {
            this.platform.deviceUpdateError(this.accessory, err, false);
        }
    }

    markStatus(isOnline) {
        this.isOnline = isOnline;
    }
}