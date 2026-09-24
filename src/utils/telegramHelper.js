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

/**
 * Safely send a message using the Telegram bot instance.
 * Automatically catches Telegram 400 'can\'t parse entities' errors
 * and falls back to plain text to ensure notifications are never lost.
 * 
 * @param {object} bot TelegramBot instance
 * @param {string|number} chatId 
 * @param {string} text Message content
 * @param {object} options SendMessage options (parse_mode, disable_web_page_preview, etc.)
 * @returns {Promise<object>}
 */
async function safeSendMessage(bot, chatId, text, options = {}) {
    if (!bot || !chatId || !text) return null;

    try {
        return await bot.sendMessage(chatId, text, options);
    } catch (error) {
        // If entity parsing failed (Markdown or HTML syntax error)
        const isParseError = error.message?.includes('can\'t parse entities') ||
                             error.response?.body?.description?.includes('can\'t parse entities');

        if (isParseError && options.parse_mode) {
            console.warn(`⚠️ Telegram parse_mode (${options.parse_mode}) error: ${error.message}. Retrying with plain text.`);
            // Strip common markdown characters as fallback
            const plainText = text.replace(/[*_`\[\]]/g, '');
            const fallbackOptions = { ...options };
            delete fallbackOptions.parse_mode;
            try {
                return await bot.sendMessage(chatId, plainText, fallbackOptions);
            } catch (fallbackError) {
                console.error(`❌ Plain text fallback also failed for chatId ${chatId}:`, fallbackError.message);
                throw fallbackError;
            }
        }

        // Other Telegram errors (network, blocked bot, etc.)
        console.error(`❌ Telegram sendMessage error for chatId ${chatId}:`, error.message);
        throw error;
    }
}

module.exports = {
    escapeMarkdown,
    escapeHtml,
    safeSendMessage
};
