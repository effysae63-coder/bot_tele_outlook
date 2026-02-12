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
                    });

                    await this.bot.sendMessage(chatId,
                        `💾 *Backing up ${accounts.length} accounts...*`,
                        { parse_mode: 'Markdown' }
                    );

                    let success = 0;
                    let failed = 0;

                    for (const account of accounts) {
                        try {
                            await this.createBackup(account, msg.from.username);
                            success++;
                        } catch (err) {
                            failed++;
                        }
                    }

                    await this.bot.sendMessage(chatId,
                        `✅ *Backup Complete*\n\n` +
                        `📧 Success: ${success}\n` +
                        `❌ Failed: ${failed}`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    const account = await Account.findOne({
                        email: email.toLowerCase(),
                        telegramChatId: chatId.toString()
                    });

                    if (!account) {
                        return this.bot.sendMessage(chatId, `❌ Account not found.`);
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
                        `📨 Forward: ${backup.snapshot.forwardRules?.length || 0}\n\n` +
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
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                const backup = await Backup.findOne({ backupId });

                if (!backup) {
                    return this.bot.sendMessage(chatId, `❌ Backup not found.`);
                }

                await this.bot.sendMessage(chatId,
                    `🔄 *Restoring ${account.email} from backup...*`,
                    { parse_mode: 'Markdown' }
                );

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId, `❌ Failed to connect to account.`);
                }

                let rulesRestored = 0;
                for (const rule of backup.snapshot.rules || []) {
                    try {
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
                        console.error(`Failed to restore rule ${rule.name}:`, err);
                    }
                }

                let blockedRestored = 0;
                for (const sender of backup.snapshot.blockedSenders || []) {
                    try {
                        await this.blockedManager.addBlockedSender(
                            tokenResult.accessToken,
                            account._id,
                            sender
                        );
                        blockedRestored++;
                    } catch (err) {
                        console.error(`Failed to restore blocked sender ${sender}:`, err);
                    }
                }

                account.rules = backup.snapshot.rules || [];
                account.blockedSenders = backup.snapshot.blockedSenders || [];
                account.forwardRules = backup.snapshot.forwardRules || [];
                await account.save();

                await this.bot.sendMessage(chatId,
                    `✅ *Restore Complete*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `📋 Rules restored: ${rulesRestored}\n` +
                    `🚫 Blocked restored: ${blockedRestored}\n` +
                    `🆔 Backup ID: \`${backupId}\``,
                    { parse_mode: 'Markdown' }
                );

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
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId, `❌ Failed to connect.`);
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
                    metadata: { createdBy: msg.from.username, reason: 'snapshot' }
                });

                await this.bot.sendMessage(chatId,
                    `📸 *Snapshot Created*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `🆔 ID: \`${backupId}\`\n` +
                    `📋 Rules: ${rules.length}\n` +
                    `🚫 Blocked: ${blocked.length}\n` +
                    `🕐 Time: ${new Date().toLocaleTimeString()}`,
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
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                const backups = await Backup.find({ accountId: account._id })
                    .sort({ createdAt: -1 })
                    .limit(10);

                if (backups.length === 0) {
                    return this.bot.sendMessage(chatId, `📭 No backups found for this account.`);
                }

                let msgText = `💾 *BACKUPS - ${account.email}*\n\n`;

                backups.forEach((backup, i) => {
                    const typeEmoji = backup.type === 'auto' ? '🔄' : 
                                    backup.type === 'snapshot' ? '📸' : '💾';
                    msgText += `${i+1}. ${typeEmoji} \`${backup.backupId}\`\n`;
                    msgText += `   ├ Type: ${backup.type}\n`;
                    msgText += `   ├ Date: ${backup.createdAt.toLocaleString()}\n`;
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
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                account.autoBackup = setting === 'on';
                await account.save();

                await this.bot.sendMessage(chatId,
                    `${setting === 'on' ? '✅' : '❌'} *Auto Backup ${setting === 'on' ? 'Enabled' : 'Disabled'}*\n\n` +
                    `📧 Account: ${account.email}\n` +
                    `🔄 Status: ${account.autoBackup ? 'Daily backups active' : 'Manual only'}`,
                    { parse_mode: 'Markdown' }
                );

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
                    return this.bot.sendMessage(chatId, `❌ Account not found.`);
                }

                const backup = await Backup.findOne({ backupId });

                if (!backup) {
                    return this.bot.sendMessage(chatId, `❌ Backup not found.`);
                }

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId, `❌ Failed to connect.`);
                }

                const currentRules = await this.ruleManager.getRules(tokenResult.accessToken);
                const currentBlocked = await this.blockedManager.getBlockedSenders(tokenResult.accessToken);

                const backupRules = backup.snapshot.rules || [];
                const currentRuleNames = currentRules.map(r => r.displayName);
                const backupRuleNames = backupRules.map(r => r.name);

                const missingRules = backupRuleNames.filter(name => !currentRuleNames.includes(name));
                const extraRules = currentRuleNames.filter(name => !backupRuleNames.includes(name));

                const backupBlocked = backup.snapshot.blockedSenders || [];
                const missingBlocked = backupBlocked.filter(s => !currentBlocked.includes(s));
                const extraBlocked = currentBlocked.filter(s => !backupBlocked.includes(s));

                let msgText = `📊 *COMPARE - ${account.email}*\n\n`;
                msgText += `🆔 Backup: \`${backupId}\`\n`;
                msgText += `🕐 Backup Date: ${backup.createdAt.toLocaleString()}\n\n`;

                msgText += `📋 *Rules*\n`;
                msgText += `├ Current: ${currentRules.length}\n`;
                msgText += `├ Backup: ${backupRules.length}\n`;
                msgText += `├ Missing: ${missingRules.length}\n`;
                if (missingRules.length > 0) {
                    msgText += `└ ${missingRules.slice(0, 3).join(', ')}${missingRules.length > 3 ? '...' : ''}\n`;
                }
                msgText += `\n`;

                msgText += `🚫 *Blocked Senders*\n`;
                msgText += `├ Current: ${currentBlocked.length}\n`;
                msgText += `├ Backup: ${backupBlocked.length}\n`;
                msgText += `├ Missing: ${missingBlocked.length}\n`;
                if (missingBlocked.length > 0) {
                    msgText += `└ ${missingBlocked.slice(0, 3).join(', ')}${missingBlocked.length > 3 ? '...' : ''}\n`;
                }

                await this.bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });
    }

    async createBackup(account, username) {
        const refreshToken = decryptToken(account.refreshToken);
        const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
        
        if (!tokenResult.success) {
            throw new Error('Failed to connect to account');
        }

        const rules = await this.ruleManager.getRules(tokenResult.accessToken);
        const blocked = await this.blockedManager.getBlockedSenders(tokenResult.accessToken);

        const backupId = `backup_${Date.now()}`;
        
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
            metadata: { createdBy: username, reason: 'manual_backup' }
        });

        account.lastBackup = new Date();
        await account.save();

        return backup;
    }
}

module.exports = BackupCommands;