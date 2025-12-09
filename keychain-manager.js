// Secure API key storage using OS keychain
const keytar = require('keytar');

const SERVICE_NAME = 'Texterity';

// Key identifiers
const KEYS = {
    TWITCH: 'twitch-api-key',
    STREAMLABS: 'streamlabs-api-key'
};

/**
 * Save an API key to the system keychain
 * @param {string} keyType - Key type from KEYS enum
 * @param {string} value - The API key value
 * @returns {Promise<boolean>} Success status
 */
async function saveKey(keyType, value) {
    try {
        await keytar.setPassword(SERVICE_NAME, keyType, value);
        console.log(`[Keychain] Saved ${keyType}`);
        return true;
    } catch (error) {
        console.error(`[Keychain] Failed to save ${keyType}:`, error);
        return false;
    }
}

/**
 * Retrieve an API key from the system keychain
 * @param {string} keyType - Key type from KEYS enum
 * @returns {Promise<string|null>} The API key or null if not found
 */
async function getKey(keyType) {
    try {
        const value = await keytar.getPassword(SERVICE_NAME, keyType);
        if (value) {
            console.log(`[Keychain] Retrieved ${keyType}`);
        }
        return value;
    } catch (error) {
        console.error(`[Keychain] Failed to retrieve ${keyType}:`, error);
        return null;
    }
}

/**
 * Delete an API key from the system keychain
 * @param {string} keyType - Key type from KEYS enum
 * @returns {Promise<boolean>} Success status
 */
async function deleteKey(keyType) {
    try {
        const deleted = await keytar.deletePassword(SERVICE_NAME, keyType);
        if (deleted) {
            console.log(`[Keychain] Deleted ${keyType}`);
        }
        return deleted;
    } catch (error) {
        console.error(`[Keychain] Failed to delete ${keyType}:`, error);
        return false;
    }
}

/**
 * Get all stored API keys
 * @returns {Promise<Object>} Object with all API keys
 */
async function getAllKeys() {
    const keys = {};
    for (const [name, keyType] of Object.entries(KEYS)) {
        keys[name.toLowerCase()] = await getKey(keyType);
    }
    return keys;
}

/**
 * Check if keytar is available on this system
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
    try {
        // Try to perform a simple operation
        await keytar.findCredentials(SERVICE_NAME);
        return true;
    } catch (error) {
        console.error('[Keychain] Not available:', error);
        return false;
    }
}

module.exports = {
    KEYS,
    saveKey,
    getKey,
    deleteKey,
    getAllKeys,
    isAvailable
};
