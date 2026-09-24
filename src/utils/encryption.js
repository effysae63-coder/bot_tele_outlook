// src/utils/encryption.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// In-memory cache for legacy PBKDF2 derived keys (salt -> key)
// This ensures that legacy tokens in DB only trigger PBKDF2 ONCE upon first read,
// completely eliminating event loop freezes during periodic monitoring.
const legacySaltKeyCache = new Map();
const MAX_CACHE_SIZE = 1000;

let cachedMasterKey = null;

/**
 * Returns a 32-byte master encryption key derived once via SHA-256 from ENCRYPTION_KEY.
 * Running SHA-256 once takes <0.01ms and never freezes the Node.js event loop.
 */
const getMasterKey = () => {
    if (!cachedMasterKey) {
        const secret = process.env.ENCRYPTION_KEY;
        if (!secret) {
            console.warn('⚠️ WARNING: ENCRYPTION_KEY not set in .env! Using temporary fallback.');
            cachedMasterKey = crypto.createHash('sha256').update('default-temporary-key-min-32-chars').digest();
        } else {
            cachedMasterKey = crypto.createHash('sha256').update(secret).digest();
        }
    }
    return cachedMasterKey;
};

/**
 * Legacy key derivation with salt using PBKDF2 with in-memory caching.
 */
const getLegacyKeyWithCache = (salt) => {
    const saltHex = salt.toString('hex');
    if (legacySaltKeyCache.has(saltHex)) {
        return legacySaltKeyCache.get(saltHex);
    }

    const secret = process.env.ENCRYPTION_KEY || 'default-temporary-key-min-32-chars';
    const key = crypto.pbkdf2Sync(
        secret,
        salt,
        100000,
        KEY_LENGTH,
        'sha256'
    );

    if (legacySaltKeyCache.size >= MAX_CACHE_SIZE) {
        // Evict oldest entry
        const oldestKey = legacySaltKeyCache.keys().next().value;
        legacySaltKeyCache.delete(oldestKey);
    }
    legacySaltKeyCache.set(saltHex, key);
    return key;
};

/**
 * High-performance AES-256-GCM token encryption.
 * Format: v2:<iv_hex>:<tag_hex>:<ciphertext_hex>
 * @param {string} text Plaintext to encrypt
 * @returns {string|null}
 */
const encryptToken = (text) => {
    try {
        if (!text) return null;

        const iv = crypto.randomBytes(IV_LENGTH);
        const key = getMasterKey();

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(text, 'utf8'),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();

        return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
        console.error('❌ Encryption error:', error.message);
        throw new Error('Failed to encrypt token');
    }
};

/**
 * High-performance AES-256-GCM token decryption.
 * Supports both v2 format and legacy PBKDF2 format seamlessly.
 * @param {string} encryptedData 
 * @returns {string|null}
 */
const decryptToken = (encryptedData) => {
    try {
        if (!encryptedData) return null;

        // V2 Format: v2:<iv_hex>:<tag_hex>:<ciphertext_hex>
        if (typeof encryptedData === 'string' && encryptedData.startsWith('v2:')) {
            const parts = encryptedData.split(':');
            if (parts.length !== 4) {
                throw new Error('Invalid v2 encrypted token format');
            }

            const iv = Buffer.from(parts[1], 'hex');
            const tag = Buffer.from(parts[2], 'hex');
            const encrypted = Buffer.from(parts[3], 'hex');
            const key = getMasterKey();

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(tag);

            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);

            return decrypted.toString('utf8');
        }

        // Legacy format: raw hex concat [salt(64), iv(16), tag(16), encrypted(...)]
        const data = Buffer.from(encryptedData, 'hex');
        if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
            throw new Error('Invalid legacy encrypted token length');
        }

        const salt = data.subarray(0, SALT_LENGTH);
        const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

        const key = getLegacyKeyWithCache(salt);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    } catch (error) {
        console.error('❌ Decryption error:', error.message);
        throw new Error('Failed to decrypt token');
    }
};

module.exports = { encryptToken, decryptToken };