// src/bot/commands/backup.js
const Account = require('../../models/Account');
const Backup = require('../../models/Backup');
const Log = require('../../models/Log');
const { decryptToken } = require('../../utils/encryption');

class BackupCommands {
    constructor(bot, outlookAuth, ruleManager, blockedManager) {
        this.bot = bot;
        this.outlookAuth = outlookAuth;
        this.ruleManager = ruleManager;
        this.blockedManager = blockedManager;
        this.setupCommands();
    }

    setupCommands() {
        // ============= BACKUP ACCOUNT =============
        this.bot.onText(/\/backup(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/backup user@outlook.com`\n' +
                    '       `/backup all` - Backup all accounts',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                if (email === 'all') {
                    const accounts = await Account.find({
                        telegramChatId: chatId.toString(),
                        status: 'active'
                    }).lean();

                    if (accounts.length === 0) {
                        return this.bot.sendMessage(chatId,
                            '📭 *No active accounts found*',
                            { parse_mode: 'Markdown' }
                        );
                    }

                    const statusMsg = await this.bot.sendMessage(chatId,
                        `💾 *Backing up ${accounts.length} accounts...*`,
                        { parse_mode: 'Markdown' }
                    );

                    let success = 0;
                    let failed = 0;

                    for (let i = 0; i < accounts.length; i++) {
                        try {
                            await this.createBackup(accounts[i], msg.from.username);
                            success++;
                        } catch (err) {
                            console.error(`Backup failed for ${accounts[i].email}:`, err.message);
                            failed++;
                        }

                        // Update progress every 3 accounts
                        if ((i + 1) % 3 === 0 || i === accounts.length - 1) {
                            await this.bot.editMessageText(
                                `💾 *Backing up accounts...*\n` +
                                `✅ Success: ${success}\n` +
                                `❌ Failed: ${failed}\n` +
                                `📊 Progress: ${i + 1}/${accounts.length}`,
                                {
                                    chat_id: chatId,
                                    message_id: statusMsg.message_id,
                                    parse_mode: 'Markdown'
                                }
                            ).catch(() => {});
                        }
                    }

                    await this.bot.sendMessage(chatId,
                        `✅ *Backup Complete*\n\n` +
                        `📧 Success: ${success}/${accounts.length}\n` +
                        `❌ Failed: ${failed}`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    const account = await Account.findOne({
                        email: email.toLowerCase(),
                        telegramChatId: chatId.toString()
                    }).lean();

                    if (!account) {
                        return this.bot.sendMessage(chatId,
                            `❌ Account \`${email}\` not found`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    await this.bot.sendMessage(chatId,
                        `💾 *Backing up ${account.email}...*`,
                        { parse_mode: 'Markdown' }
                    );

                    const backup = await this.createBackup(account, msg.from.username);

                    await this.bot.sendMessage(chatId,
                        `✅ *Backup Created*\n\n` +
                        `📧 Account: ${account.email}\n` +
                        `🆔 Backup ID: \`${backup.backupId}\`\n` +
                        `📋 Rules: ${backup.snapshot.rules?.length || 0}\n` +
                        `🚫 Blocked: ${backup.snapshot.blockedSenders?.length || 0}\n` +
                        `📨 Forward: ${backup.snapshot.forwardRules?.length || 0}\n` +
                        `📦 Size: ${this.formatBytes(JSON.stringify(backup.snapshot).length)}\n\n` +
                        `_Use /restore ${account.email} ${backup.backupId} to restore_`,
                        { parse_mode: 'Markdown' }
                    );
                }

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= RESTORE ACCOUNT =============
        this.bot.onText(/\/restore (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [email, backupId] = match[1].split(' ');

            if (!email || !backupId) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/restore user@outlook.com backup_id`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                const backup = await Backup.findOne({ backupId });

                if (!backup) {
                    return this.bot.sendMessage(chatId,
                        `❌ Backup \`${backupId}\` not found`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // Verify backup belongs to this account
                if (backup.accountId.toString() !== account._id.toString()) {
                    return this.bot.sendMessage(chatId,
                        `❌ Backup does not belong to this account`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const statusMsg = await this.bot.sendMessage(chatId,
                    `🔄 *Restoring ${account.email} from backup...*`,
                    { parse_mode: 'Markdown' }
                );

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId,
                        `❌ Failed to connect to account.\nPlease /reconnect first.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // Get current rules to avoid duplicates
                const currentRules = await this.ruleManager.getRules(tokenResult.accessToken);
                const currentRuleNames = currentRules.map(r => r.displayName);

                let rulesRestored = 0;
                let rulesSkipped = 0;

                for (const rule of backup.snapshot.rules || []) {
                    try {
                        // Skip if rule already exists
                        if (currentRuleNames.includes(rule.name)) {
                            rulesSkipped++;
                            continue;
                        }

                        await this.ruleManager.createCustomRule(
                            tokenResult.accessToken,
                            account._id,
                            {
                                displayName: rule.name,
                                conditions: rule.conditions,
                                actions: rule.actions,
                                isEnabled: rule.isEnabled
                            }
                        );
                        rulesRestored++;
                    } catch (err) {
                        console.error(`Failed to restore rule ${rule.name}:`, err.message);
                    }
                }

                let blockedRestored = 0;
                let blockedSkipped = 0;

                for (const sender of backup.snapshot.blockedSenders || []) {
                    try {
                        const isBlocked = await this.blockedManager.isSenderBlocked(
                            tokenResult.accessToken,
                            sender
                        );
                        
                        if (isBlocked) {
                            blockedSkipped++;
                            continue;
                        }

                        await this.blockedManager.addBlockedSender(
                            tokenResult.accessToken,
                            account._id,
                            sender
                        );
                        blockedRestored++;
                    } catch (err) {
                        console.error(`Failed to restore blocked sender ${sender}:`, err.message);
                    }
                }

                // Update account with restored data
                account.rules = [...(account.rules || []), ...backup.snapshot.rules];
                account.blockedSenders = [...new Set([...(account.blockedSenders || []), ...(backup.snapshot.blockedSenders || [])])];
                account.forwardRules = backup.snapshot.forwardRules || [];
                await account.save();

                await this.bot.editMessageText(
                    `✅ *Restore Complete*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `📋 Rules: ${rulesRestored} restored, ${rulesSkipped} skipped\n` +
                    `🚫 Blocked: ${blockedRestored} restored, ${blockedSkipped} skipped\n` +
                    `🆔 Backup ID: \`${backupId}\`\n` +
                    `🕐 Restore Time: ${new Date().toLocaleTimeString()}`,
                    {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );

                // Log restore action
                await Log.create({
                    accountId: account._id,
                    action: 'backup_restored',
                    status: 'success',
                    message: `Restored from backup ${backupId}`,
                    details: {
                        backupId,
                        rulesRestored,
                        blockedRestored,
                        timestamp: new Date()
                    }
                });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= SNAPSHOT =============
        this.bot.onText(/\/snapshot(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/snapshot user@outlook.com`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId,
                        `❌ Failed to connect to account.\nPlease /reconnect first.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const rules = await this.ruleManager.getRules(tokenResult.accessToken);
                const blocked = await this.blockedManager.getBlockedSenders(tokenResult.accessToken);

                const backupId = `snapshot_${Date.now()}`;
                await Backup.create({
                    backupId,
                    accountId: account._id,
                    accountEmail: account.email,
                    snapshot: {
                        rules: rules.map(r => ({
                            ruleId: r.id,
                            name: r.displayName,
                            conditions: r.conditions,
                            actions: r.actions,
                            isEnabled: r.isEnabled
                        })),
                        blockedSenders: blocked,
                        forwardRules: account.forwardRules || [],
                        timestamp: new Date()
                    },
                    type: 'snapshot',
                    metadata: {
                        createdBy: msg.from.username,
                        reason: 'snapshot',
                        ruleCount: rules.length,
                        blockedCount: blocked.length
                    }
                });

                await this.bot.sendMessage(chatId,
                    `📸 *Snapshot Created*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `🆔 ID: \`${backupId}\`\n` +
                    `📋 Rules: ${rules.length}\n` +
                    `🚫 Blocked: ${blocked.length}\n` +
                    `📨 Forward: ${account.forwardRules?.length || 0}\n` +
                    `🕐 Time: ${new Date().toLocaleTimeString()}\n\n` +
                    `_Snapshot captures current state, not a full backup_`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= LIST BACKUPS =============
        this.bot.onText(/\/backups(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/backups user@outlook.com`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                const backups = await Backup.find({ accountId: account._id })
                    .sort({ createdAt: -1 })
                    .limit(15)
                    .lean();

                if (backups.length === 0) {
                    return this.bot.sendMessage(chatId,
                        `📭 *No backups found*\n\nUse /backup ${email} to create your first backup.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                let msgText = `💾 *BACKUPS - ${account.email}*\n\n`;
                msgText += `━━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `📊 Total: ${backups.length} backups\n`;
                msgText += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

                backups.forEach((backup, i) => {
                    const typeEmoji = backup.type === 'auto' ? '🔄' : 
                                    backup.type === 'snapshot' ? '📸' : '💾';
                    const date = new Date(backup.createdAt);
                    const today = new Date();
                    const isToday = date.toDateString() === today.toDateString();
                    const dateStr = isToday ? `Today at ${date.toLocaleTimeString()}` : date.toLocaleString();
                    
                    msgText += `${i+1}. ${typeEmoji} \`${backup.backupId}\`\n`;
                    msgText += `   ├ Type: ${backup.type}\n`;
                    msgText += `   ├ Date: ${dateStr}\n`;
                    msgText += `   ├ Rules: ${backup.snapshot.rules?.length || 0}\n`;
                    msgText += `   └ Blocked: ${backup.snapshot.blockedSenders?.length || 0}\n\n`;
                });

                msgText += `_Use /restore ${account.email} backup_id to restore_`;

                await this.bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= AUTO BACKUP TOGGLE =============
        this.bot.onText(/\/auto backup (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [email, setting] = match[1].split(' ');

            if (!email || !['on', 'off'].includes(setting)) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/auto backup user@outlook.com on`\n' +
                    '       `/auto backup user@outlook.com off`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                account.autoBackup = setting === 'on';
                await account.save();

                await this.bot.sendMessage(chatId,
                    `${setting === 'on' ? '✅' : '❌'} *Auto Backup ${setting === 'on' ? 'Enabled' : 'Disabled'}*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `🔄 Status: ${account.autoBackup ? 'Daily backups at 2:00 AM' : 'Manual only'}\n` +
                    `${account.autoBackup ? '💾 Next backup: Tonight at 2:00 AM' : ''}`,
                    { parse_mode: 'Markdown' }
                );

                await Log.create({
                    accountId: account._id,
                    action: 'backup_created',
                    status: 'info',
                    message: `Auto backup ${setting === 'on' ? 'enabled' : 'disabled'}`,
                    details: { autoBackup: account.autoBackup }
                });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= COMPARE WITH BACKUP =============
        this.bot.onText(/\/compare (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [email, backupId] = match[1].split(' ');

            if (!email || !backupId) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/compare user@outlook.com backup_id`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                const backup = await Backup.findOne({ backupId });

                if (!backup) {
                    return this.bot.sendMessage(chatId,
                        `❌ Backup \`${backupId}\` not found`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId,
                        `❌ Failed to connect to account.\nPlease /reconnect first.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const statusMsg = await this.bot.sendMessage(chatId,
                    `🔍 *Comparing ${account.email} with backup...*`,
                    { parse_mode: 'Markdown' }
                );

                const [currentRules, currentBlocked] = await Promise.all([
                    this.ruleManager.getRules(tokenResult.accessToken),
                    this.blockedManager.getBlockedSenders(tokenResult.accessToken)
                ]);

                const backupRules = backup.snapshot.rules || [];
                const backupRuleNames = backupRules.map(r => r.name);
                const currentRuleNames = currentRules.map(r => r.displayName);

                // Find differences
                const missingRules = backupRuleNames.filter(name => !currentRuleNames.includes(name));
                const extraRules = currentRuleNames.filter(name => !backupRuleNames.includes(name));

                const backupBlocked = backup.snapshot.blockedSenders || [];
                const missingBlocked = backupBlocked.filter(s => !currentBlocked.includes(s));
                const extraBlocked = currentBlocked.filter(s => !backupBlocked.includes(s));

                const backupDate = new Date(backup.createdAt);
                const daysSince = Math.floor((Date.now() - backupDate) / (1000 * 60 * 60 * 24));

                let msgText = `📊 *COMPARISON RESULT*\n\n`;
                msgText += `📧 Account: ${account.email}\n`;
                msgText += `🆔 Backup: \`${backupId}\`\n`;
                msgText += `🕐 Backup Date: ${backupDate.toLocaleString()}\n`;
                msgText += `📆 ${daysSince} day${daysSince !== 1 ? 's' : ''} ago\n\n`;

                msgText += `━━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `📋 *RULES*\n`;
                msgText += `━━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `├ Current: ${currentRules.length}\n`;
                msgText += `├ Backup: ${backupRules.length}\n`;
                msgText += `├ Difference: ${Math.abs(currentRules.length - backupRules.length)}\n\n`;

                if (missingRules.length > 0) {
                    msgText += `❌ *Missing from current:*\n`;
                    missingRules.slice(0, 5).forEach(name => {
                        msgText += `├ • \`${name}\`\n`;
                    });
                    if (missingRules.length > 5) {
                        msgText += `└ ... and ${missingRules.length - 5} more\n`;
                    }
                    msgText += `\n`;
                }

                if (extraRules.length > 0) {
                    msgText += `➕ *Added since backup:*\n`;
                    extraRules.slice(0, 5).forEach(name => {
                        msgText += `├ • \`${name}\`\n`;
                    });
                    if (extraRules.length > 5) {
                        msgText += `└ ... and ${extraRules.length - 5} more\n`;
                    }
                    msgText += `\n`;
                }

                msgText += `━━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `🚫 *BLOCKED SENDERS*\n`;
                msgText += `━━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `├ Current: ${currentBlocked.length}\n`;
                msgText += `├ Backup: ${backupBlocked.length}\n`;
                msgText += `├ Difference: ${Math.abs(currentBlocked.length - backupBlocked.length)}\n\n`;

                if (missingBlocked.length > 0) {
                    msgText += `❌ *Unblocked since backup:*\n`;
                    missingBlocked.slice(0, 5).forEach(s => {
                        msgText += `├ • \`${s}\`\n`;
                    });
                    if (missingBlocked.length > 5) {
                        msgText += `└ ... and ${missingBlocked.length - 5} more\n`;
                    }
                    msgText += `\n`;
                }

                if (extraBlocked.length > 0) {
                    msgText += `🆕 *Newly blocked:*\n`;
                    extraBlocked.slice(0, 5).forEach(s => {
                        msgText += `├ • \`${s}\`\n`;
                    });
                    if (extraBlocked.length > 5) {
                        msgText += `└ ... and ${extraBlocked.length - 5} more\n`;
                    }
                    msgText += `\n`;
                }

                await this.bot.editMessageText(msgText, {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= DELETE BACKUP =============
        this.bot.onText(/\/delete backup (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [email, backupId] = match[1].split(' ');

            if (!email || !backupId) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/delete backup user@outlook.com backup_id`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
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

                const backup = await Backup.findOne({ backupId });

                if (!backup) {
                    return this.bot.sendMessage(chatId,
                        `❌ Backup \`${backupId}\` not found`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // Verify backup belongs to this account
                if (backup.accountId.toString() !== account._id.toString()) {
                    return this.bot.sendMessage(chatId,
                        `❌ Backup does not belong to this account`,
                        { parse_mode: 'Markdown' }
                    );
                }

                await Backup.deleteOne({ backupId });

                await this.bot.sendMessage(chatId,
                    `🗑️ *Backup Deleted*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `🆔 Backup ID: \`${backupId}\`\n` +
                    `📋 Type: ${backup.type}\n` +
                    `🕐 Created: ${new Date(backup.createdAt).toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });
    }

    async createBackup(account, username) {
        if (!account || !account._id) {
            throw new Error('Invalid account object');
        }

        const refreshToken = decryptToken(account.refreshToken);
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
        
        if (!tokenResult.success) {
            throw new Error('Failed to connect to account: ' + (tokenResult.error || 'Unknown error'));
        }

        const [rules, blocked] = await Promise.all([
            this.ruleManager.getRules(tokenResult.accessToken).catch(err => {
                console.error('Failed to fetch rules:', err.message);
                return [];
            }),
            this.blockedManager.getBlockedSenders(tokenResult.accessToken).catch(err => {
                console.error('Failed to fetch blocked senders:', err.message);
                return [];
            })
        ]);

        const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        
        const backup = await Backup.create({
            backupId,
            accountId: account._id,
            accountEmail: account.email,
            snapshot: {
                rules: rules.map(r => ({
                    ruleId: r.id,
                    name: r.displayName,
                    conditions: r.conditions,
                    actions: r.actions,
                    isEnabled: r.isEnabled
                })),
                blockedSenders: blocked,
                forwardRules: account.forwardRules || [],
                timestamp: new Date()
            },
            type: 'manual',
            metadata: {
                createdBy: username || 'system',
                reason: 'manual_backup',
                ruleCount: rules.length,
                blockedCount: blocked.length,
                timestamp: Date.now()
            }
        });

        await Account.updateOne(
            { _id: account._id },
            { $set: { lastBackup: new Date() } }
        );

        await Log.create({
            accountId: account._id,
            action: 'backup_created',
            status: 'success',
            message: `Manual backup created`,
            details: { backupId, rulesCount: rules.length, blockedCount: blocked.length }
        });

        return backup;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

module.exports = BackupCommands;