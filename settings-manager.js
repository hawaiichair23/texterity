// User settings manager - auto-saves to AppData/Roaming
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Get platform-specific settings directory
const SETTINGS_DIR = path.join(app.getPath('userData'), 'Texterity');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'user-settings.json');

// Default settings
const DEFAULT_SETTINGS = {
    version: '1.0',
    ui: {
        accentColor: '#3e73ca',
        showOverlayControls: true
    },
    defaults: {
        fontSize: 48,
        startingText: 'New Text Object',
        animationPreset: 'animation-1'
    },
    autoSave: {
        enabled: false,
        interval: 5 // minutes
    },
    lastProjectFile: null // Track last opened project
};

/**
 * Ensure settings directory exists
 */
function ensureSettingsDir() {
    if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
}

/**
 * Load user settings from disk
 * @returns {Object} Settings object
 */
function loadSettings() {
    ensureSettingsDir();    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(data);
            
            // Merge with defaults in case new settings were added
            return { ...DEFAULT_SETTINGS, ...settings };
        }
    } catch (error) {
        console.log("Error with settings")
    }
    
    // Return defaults if file doesn't exist or there was an error
    return { ...DEFAULT_SETTINGS };
}

/**
 * Save user settings to disk
 * @param {Object} settings - Settings object to save
 * @returns {boolean} Success status
 */
function saveSettings(settings) {
    ensureSettingsDir();
    
    try {
        // Add timestamp
        settings.lastSaved = new Date().toISOString();
        
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Update a specific setting (deep merge)
 * @param {Object} currentSettings - Current settings
 * @param {string} path - Dot-notation path (e.g., "ui.accentColor")
 * @param {*} value - New value
 * @returns {Object} Updated settings
 */
function updateSetting(currentSettings, path, value) {
    // Safety check
    if (!path || typeof path !== 'string') {
        console.error('updateSetting: invalid path', path);
        return currentSettings;
    }
    
    const keys = path.split('.');
    const updated = { ...currentSettings };
    
    let target = updated;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) {
            target[keys[i]] = {};
        }
        target = target[keys[i]];
    }
    
    target[keys[keys.length - 1]] = value;
    return updated;
}

/**
 * Get the settings file path (for debugging)
 * @returns {string}
 */
function getSettingsPath() {
    return SETTINGS_FILE;
}

module.exports = {
    loadSettings,
    saveSettings,
    updateSetting,
    getSettingsPath,
    DEFAULT_SETTINGS
};
