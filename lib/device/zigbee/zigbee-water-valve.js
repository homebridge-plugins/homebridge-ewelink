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
            this.service.updateCharacteristic(this.hapChar.SetDuration, 360); // Default 6 minutes
            this.service.addCharacteristic(this.hapChar.RemainingDuration);
        }

        // Restore timer state if it exists
        if (this.accessory.context.timerEndTime) {
            const now = Date.now();
            if (now < this.accessory.context.timerEndTime) {
                // Timer should still be running
                const remainingTime = Math.round((this.accessory.context.timerEndTime - now) / 1000);
                this.service.updateCharacteristic(this.hapChar.RemainingDuration, remainingTime);
                this.startTimer(remainingTime);
            } else {
                // Timer has expired, clean up
                this.service.updateCharacteristic(this.hapChar.Active, 0);
                this.service.updateCharacteristic(this.hapChar.InUse, 0);
                this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
                delete this.accessory.context.timerEndTime;
            }
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
                        this.startTimer(duration);
                    } else {
                        // If turning off, clear the timer and reset remaining duration
                        this.clearTimer();
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
                    // Update timer with new duration if valve is currently active
                    this.startTimer(value);
                }
            });

        this.log('[%s] initialized as a Zigbee Smart Water Valve.', this.name);
    }

    startTimer(duration) {
        // Clear any existing timer
        this.clearTimer();
        
        // Set timer end time and store it in context
        this.accessory.context.timerEndTime = Date.now() + (duration * 1000);
        
        // Update remaining duration
        this.service.updateCharacteristic(this.hapChar.RemainingDuration, duration);
        
        // Set new timer
        this.timer = setTimeout(() => {
            this.service.updateCharacteristic(this.hapChar.Active, 0);
            this.service.updateCharacteristic(this.hapChar.InUse, 0);
            this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
            delete this.accessory.context.timerEndTime;
        }, duration * 1000);

        // Start a periodic update of remaining duration
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            const remaining = Math.round((this.accessory.context.timerEndTime - Date.now()) / 1000);
            if (remaining > 0) {
                this.service.updateCharacteristic(this.hapChar.RemainingDuration, remaining);
            } else {
                clearInterval(this.updateInterval);
            }
        }, 1000);
    }

    clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        delete this.accessory.context.timerEndTime;
        this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0);
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
                        // If turned off externally, clear timer
                        this.clearTimer();
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