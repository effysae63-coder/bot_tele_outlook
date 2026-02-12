// src/utils/encryption.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const getKey = (salt) => {
    return crypto.pbkdf2Sync(
        process.env.ENCRYPTION_KEY,
        salt,
        100000,
        KEY_LENGTH,
        'sha256'
    );
};

const encryptToken = (text) => {
    try {
        if (!text) return null;
        
        const iv = crypto.randomBytes(IV_LENGTH);
        const salt = crypto.randomBytes(SALT_LENGTH);
        const key = getKey(salt);
        
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        const encrypted = Buffer.concat([
            cipher.update(text, 'utf8'),
            cipher.final()
        ]);
        
        const tag = cipher.getAuthTag();
        
        const result = Buffer.concat([salt, iv, tag, encrypted]);
        return result.toString('hex');
    } catch (error) {
        console.error('❌ Encryption error:', error);
        throw new Error('Failed to encrypt token');
    }
};

const decryptToken = (encryptedData) => {
    try {
        if (!encryptedData) return null;
        
        const data = Buffer.from(encryptedData, 'hex');
        
        const salt = data.subarray(0, SALT_LENGTH);
        const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        
        const key = getKey(salt);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('❌ Decryption error:', error);
        throw new Error('Failed to decrypt token');
    }
};

module.exports = { encryptToken, decryptToken };