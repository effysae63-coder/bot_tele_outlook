// src/bot/commands/account.js
const Account = require('../../models/Account');
const Backup = require('../../models/Backup');
const Log = require('../../models/Log');
const { encryptToken, decryptToken } = require('../../utils/encryption');

class AccountCommands {
    constructor(bot, outlookAuth, ruleManager, blockedManager) {
        this.bot = bot;
        this.outlookAuth = outlookAuth;
        this.ruleManager = ruleManager;
        this.blockedManager = blockedManager;
        this.setupCommands();
    }

    setupCommands() {
        // ============= ADD ACCOUNT =============
        this.bot.onText(/\/add/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const todayCount = await Account.countDocuments({
                    telegramChatId: chatId.toString(),
                    createdAt: { $gte: today }
                });
                
                if (todayCount >= 10) {
                    return this.bot.sendMessage(chatId,
                        '❌ *Daily limit reached*\nMaximum 10 accounts per day.\n' +
                        `Today: ${todayCount}/10`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const authUrl = this.outlookAuth.getAuthUrl();
                
                global.pendingAuth = global.pendingAuth || new Map();
                global.pendingAuth.set(chatId, {
                    timestamp: Date.now(),
                    type: 'add'
                });

                await this.bot.sendMessage(chatId,
                    '🔗 *ADD OUTLOOK ACCOUNT*\n\n' +
                    `📊 Daily: ${todayCount}/10\n\n` +
                    '1️⃣ Click link\n' +
                    '2️⃣ Login with Outlook\n' +
                    '3️⃣ Authorize\n' +
                    '4️⃣ Send URL here\n\n' +
                    `[🔐 LOGIN MICROSOFT](${authUrl})`,
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );

                setTimeout(() => {
                    if (global.pendingAuth?.has(chatId)) {
                        global.pendingAuth.delete(chatId);
                        this.bot.sendMessage(chatId, '⏰ Session expired. Use /add again.');
                    }
                }, 300000);

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= REMOVE ACCOUNT =============
        this.bot.onText(/\/remove(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/remove user@outlook.com`\n' +
                    '       `/remove all` - Remove all accounts',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                if (email === 'all') {
                    const accounts = await Account.find({ telegramChatId: chatId.toString() });
                    
                    for (const account of accounts) {
                        await Backup.create({
                            backupId: `pre_remove_${Date.now()}_${account._id}`,
                            accountId: account._id,
                            accountEmail: account.email,
                            snapshot: {
                                rules: account.rules || [],
                                blockedSenders: account.blockedSenders || [],
                                forwardRules: account.forwardRules || [],
                                timestamp: new Date()
                            },
                            type: 'manual',
                            metadata: { createdBy: msg.from.username, reason: 'bulk_removal_backup' }
                        });
                    }

                    const result = await Account.deleteMany({ telegramChatId: chatId.toString() });
                    
                    await this.bot.sendMessage(chatId,
                        `🗑️ *All Accounts Removed*\n\n` +
                        `📧 Total: ${result.deletedCount} accounts\n` +
                        `💾 Backups created for recovery`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    const account = await Account.findOne({
                        email: email.toLowerCase(),
                        telegramChatId: chatId.toString()
                    });

                    if (!account) {
                        return this.bot.sendMessage(chatId,
                            `❌ Account \`${email}\` not found`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    const backupId = `pre_remove_${Date.now()}`;
                    await Backup.create({
                        backupId,
                        accountId: account._id,
                        accountEmail: account.email,
                        snapshot: {
                            rules: account.rules || [],
                            blockedSenders: account.blockedSenders || [],
                            forwardRules: account.forwardRules || [],
                            timestamp: new Date()
                        },
                        type: 'manual',
                        metadata: { createdBy: msg.from.username, reason: 'account_removal' }
                    });

                    await Account.deleteOne({ _id: account._id });

                    await this.bot.sendMessage(chatId,
                        `🗑️ *Account Removed*\n\n` +
                        `📧 ${account.email}\n` +
                        `💾 Backup ID: \`${backupId}\`\n\n` +
                        `_Use /restore ${account.email} ${backupId} to recover_`,
                        { parse_mode: 'Markdown' }
                    );
                }

                global.botStats.totalAccounts = await Account.countDocuments();

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= LIST ACCOUNTS =============
        this.bot.onText(/\/list/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).sort({ createdAt: -1 }).lean();

                if (accounts.length === 0) {
                    return this.bot.sendMessage(chatId,
                        '📭 *No accounts*\nUse /add to connect your first Outlook account.',
                        { parse_mode: 'Markdown' }
                    );
                }

                let message = '📊 *YOUR ACCOUNTS*\n\n';
                message += `━━━━━━━━━━━━━━━━━━━━━\n`;
                message += `📧 Total: ${accounts.length}\n`;
                message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

                for (let i = 0; i < accounts.length; i++) {
                    const acc = accounts[i];
                    
                    let statusEmoji = '✅';
                    if (acc.status === 'reconnect_needed') statusEmoji = '🔄';
                    if (acc.status === 'expired') statusEmoji = '⚠️';
                    if (acc.status === 'error') statusEmoji = '❌';
                    
                    const lastCheck = acc.lastChecked 
                        ? this.formatTimeAgo(acc.lastChecked) 
                        : 'Never';
                    
                    message += `${i+1}. ${statusEmoji} *${acc.email}*\n`;
                    message += `   ├ Status: ${acc.status}\n`;
                    message += `   ├ Rules: ${acc.rules?.length || 0} total\n`;
                    message += `   ├ Blocked: ${acc.blockedSenders?.length || 0}\n`;
                    message += `   ├ Forward: ${acc.forwardRules?.length || 0}\n`;
                    message += `   ├ Checks: ${acc.ruleStats?.enforceCount || acc.stats?.rulesEnforced || 0}\n`;
                    message += `   └ Last: ${lastCheck}\n\n`;
                }

                if (message.length > 4000) {
                    const chunks = message.match(/[\s\S]{1,4000}/g) || [];
                    for (const chunk of chunks) {
                        await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                    }
                } else {
                    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                }

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ACCOUNT DETAILS =============
        this.bot.onText(/\/status(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            try {
                let query = { telegramChatId: chatId.toString() };
                if (email) {
                    query.email = email.toLowerCase();
                }

                const accounts = email 
                    ? [await Account.findOne(query).lean()]
                    : await Account.find(query).sort({ createdAt: -1 }).limit(5).lean();

                if (!accounts || accounts.length === 0 || !accounts[0]) {
                    return this.bot.sendMessage(chatId, '❌ Account not found.');
                }

                for (const acc of accounts) {
                    if (!acc) continue;

                    const statusEmoji = acc.status === 'active' ? '✅' : 
                                       acc.status === 'reconnect_needed' ? '🔄' : '⚠️';

                    let msg = `${statusEmoji} *${acc.email}*\n`;
                    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    
                    msg += `📊 *STATUS*\n`;
                    msg += `├ Status: ${acc.status}\n`;
                    msg += `├ Added: ${new Date(acc.createdAt).toLocaleDateString()}\n`;
                    msg += `├ Last Active: ${acc.lastActive ? new Date(acc.lastActive).toLocaleString() : 'Never'}\n`;
                    msg += `└ Last Check: ${acc.lastChecked ? new Date(acc.lastChecked).toLocaleString() : 'Never'}\n\n`;
                    
                    msg += `📋 *RULES* (${acc.rules?.length || 0})\n`;
                    const stickyRules = acc.rules?.filter(r => r.isSticky) || [];
                    if (stickyRules.length > 0) {
                        msg += `├ Sticky: ${stickyRules.map(r => r.name).join(', ')}\n`;
                    }
                    msg += `├ Restored: ${acc.stats?.rulesRestored || 0} times\n`;
                    msg += `└ Enforced: ${acc.stats?.rulesEnforced || 0} times\n\n`;
                    
                    msg += `🚫 *BLOCKED SENDERS* (${acc.blockedSenders?.length || 0})\n`;
                    if (acc.blockedSenders?.length > 0) {
                        acc.blockedSenders.slice(0, 5).forEach(s => {
                            msg += `├ • \`${s}\`\n`;
                        });
                        if (acc.blockedSenders.length > 5) {
                            msg += `└ ... and ${acc.blockedSenders.length - 5} more\n`;
                        }
                    } else {
                        msg += `└ No blocked senders\n`;
                    }
                    msg += `\n`;
                    
                    msg += `📨 *FORWARD RULES* (${acc.forwardRules?.length || 0})\n`;
                    if (acc.forwardRules?.length > 0) {
                        acc.forwardRules.slice(0, 3).forEach(rule => {
                            msg += `├ • \`${rule.sender}\` → ${rule.targetEmail}\n`;
                        });
                        if (acc.forwardRules.length > 3) {
                            msg += `└ ... and ${acc.forwardRules.length - 3} more\n`;
                        }
                    } else {
                        msg += `└ No forward rules\n`;
                    }
                    msg += `\n`;
                    
                    msg += `💾 *BACKUP*\n`;
                    msg += `├ Auto Backup: ${acc.autoBackup ? '✅' : '❌'}\n`;
                    msg += `└ Last Backup: ${acc.lastBackup ? new Date(acc.lastBackup).toLocaleString() : 'Never'}\n`;

                    await this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                }

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ACCOUNT HISTORY =============
        this.bot.onText(/\/history(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/history user@outlook.com`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                const account = await Account.findOne({
                    email: email.toLowerCase(),
                    telegramChatId: chatId.toString()
                });

                if (!account) {
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                const logs = await Log.find({ accountId: account._id })
                    .sort({ createdAt: -1 })
                    .limit(20)
                    .lean();

                let msgText = `📋 *ACCOUNT HISTORY - ${account.email}*\n\n`;

                logs.forEach(log => {
                    const time = this.formatTimeAgo(log.createdAt);
                    const emoji = log.status === 'success' ? '✅' : 
                                log.status === 'warning' ? '⚠️' : '❌';
                    msgText += `${emoji} ${time} - ${log.message || log.action}\n`;
                });

                await this.bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= RECONNECT ACCOUNT =============
        this.bot.onText(/\/reconnect\s+(.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match[1].toLowerCase();

            try {
                const account = await Account.findOne({
                    email,
                    telegramChatId: chatId.toString()
                });

                if (!account) {
                    return this.bot.sendMessage(chatId,
                        `❌ Account \`${email}\` not found`,
                        { parse_mode: 'Markdown' }
                    );
                }

                if (!account.refreshToken) {
                    return this.bot.sendMessage(chatId,
                        `⚠️ *Account has no refresh token*\n\n` +
                        `Please use /add instead of /reconnect.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const authUrl = this.outlookAuth.getAuthUrl();

                global.reconnectSessions = global.reconnectSessions || new Map();
                global.reconnectSessions.set(chatId, {
                    accountId: account._id,
                    email: account.email,
                    timestamp: Date.now()
                });

                await this.bot.sendMessage(chatId,
                    `🔄 *Reconnect Account*\n\n` +
                    `Account: \`${email}\`\n\n` +
                    `1. Click link below\n` +
                    `2. Login with Microsoft\n` +
                    `3. Send URL back here\n\n` +
                    `[🔐 LOGIN TO RECONNECT](${authUrl})`,
                    { 
                        parse_mode: 'Markdown', 
                        disable_web_page_preview: true 
                    }
                );

                setTimeout(() => {
                    if (global.reconnectSessions?.has(chatId)) {
                        global.reconnectSessions.delete(chatId);
                        this.bot.sendMessage(chatId,
                            '⏰ *Reconnect session expired*\nUse /reconnect again.',
                            { parse_mode: 'Markdown' }
                        );
                    }
                }, 300000);

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });
    }

    formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // ============= HELPER METHODS =============
    async getAccountStats(accountId) {
        try {
            const logs = await Log.countDocuments({ 
                accountId, 
                createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
            });
            
            const backups = await Backup.countDocuments({ accountId });
            
            return { logs, backups };
        } catch (error) {
            return { logs: 0, backups: 0 };
        }
    }
}

module.exports = AccountCommands;