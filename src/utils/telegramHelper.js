// src/utils/telegramHelper.js

/**
 * Escapes characters that have special meaning in Telegram's Markdown (v1) format.
 * Reserved in Markdown v1: _ * ` [ ]
 * @param {string|any} text 
 * @returns {string}
 */
function escapeMarkdown(text) {
    if (text === null || text === undefined) return '';
    return text.toString().replace(/[_*`\[\]]/g, '\\$&');
}

/**
 * Escapes characters for Telegram's HTML format.
 * @param {string|any} text 
 * @returns {string}
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

let telegramRateLimitedUntil = 0;
let lastSendTimestamp = 0;

/**
 * Safely send a message using the Telegram bot instance.
 * Automatically catches Telegram 400 'can\'t parse entities' errors
 * and falls back to plain text to ensure notifications are never lost.
 * Gracefully respects Telegram 429 rate limits and paces bursts.
 * 
 * @param {object} bot TelegramBot instance
 * @param {string|number} chatId 
 * @param {string} text Message content
 * @param {object} options SendMessage options (parse_mode, disable_web_page_preview, etc.)
 * @returns {Promise<object|null>}
 */
async function safeSendMessage(bot, chatId, text, options = {}) {
    if (!bot || !chatId || !text) return null;

    // If in a short 429 rate-limit window, wait it out up to 8s instead of silently dropping command replies
    const now = Date.now();
    if (now < telegramRateLimitedUntil) {
        const waitMs = telegramRateLimitedUntil - now;
        if (waitMs <= 8000) {
            await new Promise(r => setTimeout(r, waitMs));
        } else {
            return null;
        }
    }

    // Light burst pacing (min 80ms between sends) to prevent triggering Telegram 429
    const sinceLast = Date.now() - lastSendTimestamp;
    if (sinceLast < 80) {
        await new Promise(r => setTimeout(r, 80 - sinceLast));
    }
    lastSendTimestamp = Date.now();

    try {
        return await bot.sendMessage(chatId, text, options);
    } catch (error) {
        const errMsg = error.message || '';
        const desc = error.response?.body?.description || '';

        // Handle Telegram 429 Too Many Requests
        if (error.response?.statusCode === 429 || errMsg.includes('429') || desc.includes('Too Many Requests')) {
            const retryAfter = error.response?.body?.parameters?.retry_after || 10;
            telegramRateLimitedUntil = Date.now() + (retryAfter * 1000);
            console.warn(`⏳ Telegram 429 rate limit active. Cooling down for ${retryAfter}s.`);
            if (retryAfter <= 10) {
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                try {
                    return await bot.sendMessage(chatId, text, options);
                } catch (_) {}
            }
            return null;
        }

        // If entity parsing failed (Markdown or HTML syntax error)
        const isParseError = errMsg.includes("can't parse entities") || desc.includes("can't parse entities");
        if (isParseError && options.parse_mode) {
            console.warn(`⚠️ Telegram parse_mode (${options.parse_mode}) error: ${errMsg}. Retrying with plain text.`);
            const plainText = text.replace(/[*_`\[\]\\]/g, '');
            const fallbackOptions = { ...options };
            delete fallbackOptions.parse_mode;
            try {
                return await bot.sendMessage(chatId, plainText, fallbackOptions);
            } catch (fallbackError) {
                console.error(`❌ Plain text fallback also failed for chatId ${chatId}:`, fallbackError.message);
                return null;
            }
        }

        console.error(`❌ Telegram sendMessage error for chatId ${chatId}:`, errMsg);
        return null;
    }
}

module.exports = {
    escapeMarkdown,
    escapeHtml,
    safeSendMessage
};
