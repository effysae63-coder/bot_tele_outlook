// src/bot/commands/report.js
const Account = require('../../models/Account');
const Backup = require('../../models/Backup');
const Log = require('../../models/Log');
const Report = require('../../models/Report');

class ReportCommands {
    constructor(bot) {
        this.bot = bot;
        this.setupCommands();
    }

    setupCommands() {
        // ============= DAILY REPORT =============
        this.bot.onText(/\/report daily/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                const accountIds = accounts.map(a => a._id);
                
                const todayLogs = await Log.find({
                    accountId: { $in: accountIds },
                    createdAt: { $gte: today }
                }).lean();

                const stats = {
                    rulesEnforced: todayLogs.filter(l => l.action === 'rule_verified').length,
                    rulesRestored: todayLogs.filter(l => ['rule_restored', 'rule_created'].includes(l.action)).length,
                    sendersBlocked: todayLogs.filter(l => l.action === 'sender_blocked').length,
                    sendersUnblocked: todayLogs.filter(l => l.action === 'sender_unblocked').length,
                    sendersReblocked: todayLogs.filter(l => l.action === 'sender_reblocked').length,
                    errors: todayLogs.filter(l => l.status === 'failure').length,
                    warnings: todayLogs.filter(l => l.status === 'warning').length
                };

                const reportId = `daily_${Date.now()}_${chatId}`;
                await Report.create({
                    reportId,
                    telegramChatId: chatId.toString(),
                    type: 'daily',
                    period: { start: today, end: new Date() },
                    summary: {
                        totalAccounts: accounts.length,
                        activeAccounts: accounts.filter(a => a.status === 'active').length,
                        ...stats
                    }
                });

                const activeAccounts = accounts.filter(a => a.status === 'active').length;
                const reconnectAccounts = accounts.filter(a => a.status === 'reconnect_needed').length;
                const errorAccounts = accounts.filter(a => a.status === 'error').length;

                let reportMsg = `📊 *DAILY REPORT - ${today.toLocaleDateString()}*\n\n`;
                
                reportMsg += `📧 *Accounts*\n`;
                reportMsg += `├ Total: ${accounts.length}\n`;
                reportMsg += `├ ✅ Active: ${activeAccounts}\n`;
                reportMsg += `├ 🔄 Reconnect: ${reconnectAccounts}\n`;
                reportMsg += `└ ❌ Error: ${errorAccounts}\n\n`;
                
                reportMsg += `🛡️ *Rules*\n`;
                reportMsg += `├ ✅ Enforced: ${stats.rulesEnforced}\n`;
                reportMsg += `└ 🔄 Restored: ${stats.rulesRestored}\n\n`;
                
                reportMsg += `🚫 *Senders*\n`;
                reportMsg += `├ 🔴 Blocked: ${stats.sendersBlocked}\n`;
                reportMsg += `├ 🟢 Unblocked: ${stats.sendersUnblocked}\n`;
                reportMsg += `└ ⚠️ Re-blocked: ${stats.sendersReblocked}\n\n`;
                
                reportMsg += `⚠️ *Issues*\n`;
                reportMsg += `├ ❌ Errors: ${stats.errors}\n`;
                reportMsg += `└ ⚠️ Warnings: ${stats.warnings}\n\n`;
                
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
                reportMsg += `✅ *System Status: Operational*\n`;
                reportMsg += `🕐 Generated: ${new Date().toLocaleTimeString()}`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Daily report error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= WEEKLY REPORT =============
        this.bot.onText(/\/report weekly/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                weekAgo.setHours(0, 0, 0, 0);
                
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                const accountIds = accounts.map(a => a._id);
                
                const weekLogs = await Log.find({
                    accountId: { $in: accountIds },
                    createdAt: { $gte: weekAgo }
                }).lean();

                // Daily stats for last 7 days
                const dailyStats = {};
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    
                    const nextDay = new Date(date);
                    nextDay.setDate(nextDay.getDate() + 1);
                    
                    const dayLogs = weekLogs.filter(l => {
                        const logDate = new Date(l.createdAt);
                        return logDate >= date && logDate < nextDay;
                    });
                    
                    dailyStats[dateStr] = {
                        rules: dayLogs.filter(l => l.action.includes('rule')).length,
                        blocks: dayLogs.filter(l => l.action.includes('block')).length,
                        forwards: dayLogs.filter(l => l.action.includes('forward')).length,
                        errors: dayLogs.filter(l => l.status === 'failure').length
                    };
                }

                // Weekly totals
                const totals = {
                    rules: weekLogs.filter(l => l.action.includes('rule')).length,
                    blocks: weekLogs.filter(l => l.action.includes('block')).length,
                    forwards: weekLogs.filter(l => l.action.includes('forward')).length,
                    errors: weekLogs.filter(l => l.status === 'failure').length,
                    restored: weekLogs.filter(l => l.action === 'rule_restored').length,
                    reblocked: weekLogs.filter(l => l.action === 'sender_reblocked').length
                };

                const newAccounts = accounts.filter(a => {
                    const created = new Date(a.createdAt);
                    return created >= weekAgo;
                }).length;

                let reportMsg = `📊 *WEEKLY REPORT - Last 7 Days*\n`;
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                reportMsg += `📧 *Account Growth*\n`;
                reportMsg += `├ New: +${newAccounts}\n`;
                reportMsg += `├ Total: ${accounts.length}\n`;
                reportMsg += `└ Active: ${accounts.filter(a => a.status === 'active').length}\n\n`;
                
                reportMsg += `📈 *Daily Activity*\n`;
                Object.keys(dailyStats).forEach(date => {
                    reportMsg += `├ ${date}: `;
                    reportMsg += `📋${dailyStats[date].rules} `;
                    reportMsg += `🚫${dailyStats[date].blocks} `;
                    reportMsg += `📨${dailyStats[date].forwards} `;
                    reportMsg += `❌${dailyStats[date].errors}\n`;
                });
                reportMsg += `\n`;

                reportMsg += `📊 *Weekly Totals*\n`;
                reportMsg += `├ 📋 Rules: ${totals.rules}\n`;
                reportMsg += `├ 🔄 Restored: ${totals.restored}\n`;
                reportMsg += `├ 🚫 Blocks: ${totals.blocks}\n`;
                reportMsg += `├ ⚠️ Re-blocks: ${totals.reblocked}\n`;
                reportMsg += `├ 📨 Forwards: ${totals.forwards}\n`;
                reportMsg += `└ ❌ Errors: ${totals.errors}\n\n`;
                
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
                reportMsg += `📊 *Performance*\n`;
                reportMsg += `├ Avg Daily Rules: ${Math.round(totals.rules / 7)}\n`;
                reportMsg += `└ Avg Daily Blocks: ${Math.round(totals.blocks / 7)}`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Weekly report error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= MONTHLY REPORT =============
        this.bot.onText(/\/report monthly/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const monthAgo = new Date();
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                monthAgo.setHours(0, 0, 0, 0);
                
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                const accountIds = accounts.map(a => a._id);
                
                const monthLogs = await Log.find({
                    accountId: { $in: accountIds },
                    createdAt: { $gte: monthAgo }
                }).lean();

                const weeklyBreakdown = [];
                for (let i = 3; i >= 0; i--) {
                    const weekStart = new Date(monthAgo);
                    weekStart.setDate(weekStart.getDate() + (i * 7));
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekEnd.getDate() + 7);
                    
                    const weekLogs = monthLogs.filter(l => {
                        const logDate = new Date(l.createdAt);
                        return logDate >= weekStart && logDate < weekEnd;
                    });
                    
                    weeklyBreakdown.push({
                        week: `Week ${4-i}`,
                        rules: weekLogs.filter(l => l.action.includes('rule')).length,
                        blocks: weekLogs.filter(l => l.action.includes('block')).length,
                        errors: weekLogs.filter(l => l.status === 'failure').length
                    });
                }

                const totals = {
                    rules: monthLogs.filter(l => l.action.includes('rule')).length,
                    blocks: monthLogs.filter(l => l.action.includes('block')).length,
                    forwards: monthLogs.filter(l => l.action.includes('forward')).length,
                    errors: monthLogs.filter(l => l.status === 'failure').length,
                    restored: monthLogs.filter(l => l.action === 'rule_restored').length
                };

                const newAccounts = accounts.filter(a => {
                    const created = new Date(a.createdAt);
                    return created >= monthAgo;
                }).length;

                let reportMsg = `📊 *MONTHLY REPORT - Last 30 Days*\n`;
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                reportMsg += `📧 *Account Summary*\n`;
                reportMsg += `├ New Accounts: +${newAccounts}\n`;
                reportMsg += `├ Total Accounts: ${accounts.length}\n`;
                reportMsg += `├ Active: ${accounts.filter(a => a.status === 'active').length}\n`;
                reportMsg += `└ Reconnect Needed: ${accounts.filter(a => a.status === 'reconnect_needed').length}\n\n`;
                
                reportMsg += `📊 *Weekly Trends*\n`;
                weeklyBreakdown.forEach(week => {
                    reportMsg += `├ ${week.week}: 📋${week.rules} 🚫${week.blocks} ❌${week.errors}\n`;
                });
                reportMsg += `\n`;
                
                reportMsg += `📈 *Monthly Totals*\n`;
                reportMsg += `├ 📋 Rules Enforced: ${totals.rules}\n`;
                reportMsg += `├ 🔄 Rules Restored: ${totals.restored}\n`;
                reportMsg += `├ 🚫 Senders Blocked: ${totals.blocks}\n`;
                reportMsg += `├ 📨 Emails Forwarded: ${totals.forwards}\n`;
                reportMsg += `└ ❌ Errors: ${totals.errors}\n\n`;
                
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
                reportMsg += `📊 *Efficiency Rate*\n`;
                const successRate = monthLogs.length > 0 
                    ? Math.round((monthLogs.filter(l => l.status === 'success').length / monthLogs.length) * 100)
                    : 100;
                reportMsg += `└ ✅ Success Rate: ${successRate}%`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Monthly report error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ACCOUNT REPORT =============
        this.bot.onText(/\/report ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match[1].toLowerCase();

            try {
                const account = await Account.findOne({
                    email: email,
                    telegramChatId: chatId.toString()
                }).lean();

                if (!account) {
                    return this.bot.sendMessage(chatId, 
                        `❌ Account \`${email}\` not found.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const [logs, backups] = await Promise.all([
                    Log.find({ accountId: account._id })
                        .sort({ createdAt: -1 })
                        .limit(20)
                        .lean(),
                    Backup.find({ accountId: account._id })
                        .sort({ createdAt: -1 })
                        .limit(5)
                        .lean()
                ]);

                const statusEmoji = account.status === 'active' ? '✅' : 
                                  account.status === 'reconnect_needed' ? '🔄' : '⚠️';

                let reportMsg = `${statusEmoji} *ACCOUNT REPORT - ${account.email}*\n`;
                reportMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                reportMsg += `📧 *Status*\n`;
                reportMsg += `├ Status: ${account.status}\n`;
                reportMsg += `├ Added: ${new Date(account.createdAt).toLocaleDateString()}\n`;
                reportMsg += `├ Last Active: ${account.lastActive ? new Date(account.lastActive).toLocaleString() : 'Never'}\n`;
                reportMsg += `└ Last Check: ${account.lastChecked ? new Date(account.lastChecked).toLocaleString() : 'Never'}\n\n`;
                
                reportMsg += `📋 *Rules*\n`;
                reportMsg += `├ Total: ${account.rules?.length || 0}\n`;
                reportMsg += `├ Sticky: ${account.rules?.filter(r => r.isSticky).length || 0}\n`;
                reportMsg += `├ Restored: ${account.stats?.rulesRestored || 0}\n`;
                reportMsg += `└ Enforced: ${account.stats?.rulesEnforced || 0}\n\n`;
                
                reportMsg += `🚫 *Blocked Senders*\n`;
                reportMsg += `├ Total: ${account.blockedSenders?.length || 0}\n`;
                reportMsg += `└ Lifetime Blocks: ${account.stats?.sendersBlocked || 0}\n\n`;
                
                reportMsg += `📨 *Forward Rules*\n`;
                reportMsg += `├ Total: ${account.forwardRules?.length || 0}\n`;
                if (account.forwardRules?.length > 0) {
                    account.forwardRules.slice(0, 3).forEach(rule => {
                        reportMsg += `├ • \`${rule.sender}\` → ${rule.targetEmail}\n`;
                    });
                }
                reportMsg += `\n`;
                
                reportMsg += `💾 *Backups*\n`;
                reportMsg += `├ Auto Backup: ${account.autoBackup ? '✅' : '❌'}\n`;
                reportMsg += `├ Total Backups: ${backups.length}\n`;
                reportMsg += `└ Last Backup: ${account.lastBackup ? new Date(account.lastBackup).toLocaleString() : 'Never'}\n\n`;
                
                reportMsg += `📈 *Recent Activity (Last 5)*\n`;
                if (logs.length > 0) {
                    logs.slice(0, 5).forEach(log => {
                        const time = this.formatTimeAgo(log.createdAt);
                        const emoji = log.status === 'success' ? '✅' : 
                                    log.status === 'warning' ? '⚠️' : '❌';
                        reportMsg += `├ ${emoji} ${time} - ${log.message || log.action}\n`;
                    });
                } else {
                    reportMsg += `└ No recent activity\n`;
                }

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Account report error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= SUMMARY =============
        this.bot.onText(/\/summary/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                const total = accounts.length;
                const active = accounts.filter(a => a.status === 'active').length;
                const reconnect = accounts.filter(a => a.status === 'reconnect_needed').length;
                const error = accounts.filter(a => a.status === 'error').length;
                
                const totalRules = accounts.reduce((sum, a) => sum + (a.rules?.length || 0), 0);
                const totalBlocked = accounts.reduce((sum, a) => sum + (a.blockedSenders?.length || 0), 0);
                const totalForward = accounts.reduce((sum, a) => sum + (a.forwardRules?.length || 0), 0);
                const totalRestored = accounts.reduce((sum, a) => sum + (a.stats?.rulesRestored || 0), 0);
                const totalBlocks = accounts.reduce((sum, a) => sum + (a.stats?.sendersBlocked || 0), 0);
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const todayAccounts = accounts.filter(a => new Date(a.createdAt) >= today).length;
                
                const accountIds = accounts.map(a => a._id);
                const todayLogs = await Log.countDocuments({
                    accountId: { $in: accountIds },
                    createdAt: { $gte: today }
                });

                let summaryMsg = `📊 *QUICK SUMMARY*\n`;
                summaryMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                summaryMsg += `📧 *Accounts*\n`;
                summaryMsg += `├ Total: ${total}\n`;
                summaryMsg += `├ ✅ Active: ${active}\n`;
                summaryMsg += `├ 🔄 Reconnect: ${reconnect}\n`;
                summaryMsg += `├ ❌ Error: ${error}\n`;
                summaryMsg += `└ 🆕 Today: +${todayAccounts}\n\n`;
                
                summaryMsg += `📋 *Configuration*\n`;
                summaryMsg += `├ 📋 Rules: ${totalRules}\n`;
                summaryMsg += `├ 🚫 Blocked: ${totalBlocked}\n`;
                summaryMsg += `└ 📨 Forward: ${totalForward}\n\n`;
                
                summaryMsg += `📊 *Lifetime*\n`;
                summaryMsg += `├ 🔄 Rules Restored: ${totalRestored}\n`;
                summaryMsg += `└ 🚫 Senders Blocked: ${totalBlocks}\n\n`;
                
                summaryMsg += `📈 *Today*\n`;
                summaryMsg += `└ 📊 Activities: ${todayLogs}\n\n`;
                
                summaryMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
                summaryMsg += `✅ *System Operational*`;

                await this.bot.sendMessage(chatId, summaryMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Summary error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= STATS =============
        this.bot.onText(/\/stats/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                const total = accounts.length;
                const active = accounts.filter(a => a.status === 'active').length;
                
                const totalRules = accounts.reduce((sum, a) => sum + (a.rules?.length || 0), 0);
                const totalBlocked = accounts.reduce((sum, a) => sum + (a.blockedSenders?.length || 0), 0);
                const totalForward = accounts.reduce((sum, a) => sum + (a.forwardRules?.length || 0), 0);
                
                const totalRestored = accounts.reduce((sum, a) => sum + (a.stats?.rulesRestored || 0), 0);
                const totalBlocks = accounts.reduce((sum, a) => sum + (a.stats?.sendersBlocked || 0), 0);
                const totalForwards = accounts.reduce((sum, a) => sum + (a.stats?.emailsForwarded || 0), 0);
                
                const uptime = process.uptime();
                const days = Math.floor(uptime / 86400);
                const hours = Math.floor((uptime % 86400) / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                
                const totalBackups = await Backup.countDocuments({
                    accountId: { $in: accounts.map(a => a._id) }
                });

                let statsMsg = `📊 *BOT STATISTICS*\n`;
                statsMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                statsMsg += `🤖 *System*\n`;
                statsMsg += `├ Uptime: ${days}d ${hours}h ${minutes}m\n`;
                statsMsg += `├ Accounts: ${total}\n`;
                statsMsg += `├ ✅ Active: ${active}\n`;
                statsMsg += `└ 💾 Backups: ${totalBackups}\n\n`;
                
                statsMsg += `📋 *Configuration*\n`;
                statsMsg += `├ 📋 Rules: ${totalRules}\n`;
                statsMsg += `├ 🚫 Blocked: ${totalBlocked}\n`;
                statsMsg += `└ 📨 Forward: ${totalForward}\n\n`;
                
                statsMsg += `📈 *Lifetime Activity*\n`;
                statsMsg += `├ 🔄 Rules Restored: ${totalRestored}\n`;
                statsMsg += `├ 🚫 Senders Blocked: ${totalBlocks}\n`;
                statsMsg += `└ 📨 Emails Forwarded: ${totalForwards}\n\n`;
                
                statsMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
                statsMsg += `⚡ *Ultra-Fast Monitoring*\n`;
                statsMsg += `├ Block Check: 2-5 sec\n`;
                statsMsg += `└ Rule Check: 10 sec`;

                await this.bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('❌ Stats error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= LOGS =============
        this.bot.onText(/\/logs(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            try {
                let accounts;
                if (email) {
                    accounts = await Account.find({ 
                        email: email.toLowerCase(),
                        telegramChatId: chatId.toString()
                    }).lean();
                    
                    if (accounts.length === 0) {
                        return this.bot.sendMessage(chatId, 
                            `❌ Account \`${email}\` not found.`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                } else {
                    accounts = await Account.find({ 
                        telegramChatId: chatId.toString() 
                    }).sort({ lastActive: -1 }).limit(3).lean();
                    
                    if (accounts.length === 0) {
                        return this.bot.sendMessage(chatId, 
                            '📭 No accounts found.',
                            { parse_mode: 'Markdown' }
                        );
                    }
                }

                for (const account of accounts) {
                    const logs = await Log.find({ accountId: account._id })
                        .sort({ createdAt: -1 })
                        .limit(15)
                        .lean();

                    if (logs.length > 0) {
                        let logMsg = `📋 *Recent Activity - ${account.email}*\n`;
                        logMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        
                        logs.forEach(log => {
                            const time = this.formatTimeAgo(log.createdAt);
                            const emoji = log.status === 'success' ? '✅' : 
                                        log.status === 'warning' ? '⚠️' : '❌';
                            const action = log.message || log.action.replace(/_/g, ' ');
                            logMsg += `${emoji} ${time} - ${action}\n`;
                        });

                        await this.bot.sendMessage(chatId, logMsg, { parse_mode: 'Markdown' });
                    } else {
                        await this.bot.sendMessage(chatId, 
                            `📭 No activity logs for ${account.email}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }

            } catch (error) {
                console.error('❌ Logs error:', error);
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= EXPORT =============
        this.bot.onText(/\/export (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const format = match[1].toLowerCase();

            if (!['json', 'csv', 'txt'].includes(format)) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/export json`\n' +
                    '       `/export csv`\n' +
                    '       `/export txt`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                const statusMsg = await this.bot.sendMessage(chatId,
                    `📊 *Exporting data to ${format.toUpperCase()}...*`,
                    { parse_mode: 'Markdown' }
                );

                const accounts = await Account.find({ 
                    telegramChatId: chatId.toString() 
                }).lean();
                
                if (accounts.length === 0) {
                    return this.bot.sendMessage(chatId, '📭 No accounts to export.');
                }

                const accountIds = accounts.map(a => a._id);
                const [logs, backups] = await Promise.all([
                    Log.find({ accountId: { $in: accountIds } })
                        .sort({ createdAt: -1 })
                        .limit(100)
                        .lean(),
                    Backup.find({ accountId: { $in: accountIds } })
                        .sort({ createdAt: -1 })
                        .limit(50)
                        .lean()
                ]);

                let fileName = `outlook_bot_export_${Date.now()}`;
                let fileContent;
                let caption;
                
                if (format === 'json') {
                    const exportData = {
                        exportDate: new Date().toISOString(),
                        version: '3.0.0',
                        summary: {
                            totalAccounts: accounts.length,
                            totalLogs: logs.length,
                            totalBackups: backups.length
                        },
                        accounts: accounts.map(a => ({
                            email: a.email,
                            status: a.status,
                            createdAt: a.createdAt,
                            lastActive: a.lastActive,
                            stats: a.stats,
                            ruleStats: a.ruleStats,
                            rules: a.rules?.map(r => ({
                                name: r.name,
                                isSticky: r.isSticky,
                                isEnabled: r.isEnabled,
                                conditions: r.conditions,
                                actions: r.actions
                            })),
                            blockedSenders: a.blockedSenders,
                            forwardRules: a.forwardRules
                        })),
                        recentLogs: logs.slice(0, 50).map(l => ({
                            action: l.action,
                            status: l.status,
                            message: l.message,
                            createdAt: l.createdAt
                        }))
                    };
                    
                    fileContent = JSON.stringify(exportData, null, 2);
                    caption = `📊 JSON Export: ${accounts.length} accounts, ${logs.length} logs`;
                    
                } else if (format === 'csv') {
                    let csv = 'Account Email,Status,Created,Rules,Blocked,Forwards,Restored,Blocks\n';
                    accounts.forEach(a => {
                        csv += `"${a.email}",${a.status},${new Date(a.createdAt).toLocaleDateString()},`;
                        csv += `${a.rules?.length || 0},${a.blockedSenders?.length || 0},${a.forwardRules?.length || 0},`;
                        csv += `${a.stats?.rulesRestored || 0},${a.stats?.sendersBlocked || 0}\n`;
                    });
                    
                    fileContent = csv;
                    caption = `📊 CSV Export: ${accounts.length} accounts`;
                    
                } else {
                    let txt = `OUTLOOK BOT EXPORT - ${new Date().toLocaleString()}\n`;
                    txt += `==============================================\n\n`;
                    txt += `SUMMARY\n`;
                    txt += `-------\n`;
                    txt += `Total Accounts: ${accounts.length}\n`;
                    txt += `Active Accounts: ${accounts.filter(a => a.status === 'active').length}\n`;
                    txt += `Total Logs: ${logs.length}\n`;
                    txt += `Total Backups: ${backups.length}\n\n`;
                    
                    accounts.forEach((a, i) => {
                        txt += `ACCOUNT ${i+1}: ${a.email}\n`;
                        txt += `${'='.repeat(40)}\n`;
                        txt += `Status: ${a.status}\n`;
                        txt += `Added: ${new Date(a.createdAt).toLocaleString()}\n`;
                        txt += `Last Active: ${a.lastActive ? new Date(a.lastActive).toLocaleString() : 'Never'}\n`;
                        txt += `Rules: ${a.rules?.length || 0}\n`;
                        txt += `Blocked Senders: ${a.blockedSenders?.length || 0}\n`;
                        txt += `Forward Rules: ${a.forwardRules?.length || 0}\n`;
                        txt += `Rules Restored: ${a.stats?.rulesRestored || 0}\n`;
                        txt += `Senders Blocked: ${a.stats?.sendersBlocked || 0}\n`;
                        txt += `Emails Forwarded: ${a.stats?.emailsForwarded || 0}\n\n`;
                    });
                    
                    fileContent = txt;
                    caption = `📊 TXT Export: ${accounts.length} accounts`;
                }

                await this.bot.editMessageText(
                    `📤 *Uploading ${format.toUpperCase()} file...*`,
                    {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );

                await this.bot.sendDocument(chatId, Buffer.from(fileContent), {
                    filename: `${fileName}.${format}`,
                    caption: caption
                });

                await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

            } catch (error) {
                console.error('❌ Export error:', error);
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
        if (days < 7) return `${days}d ago`;
        const weeks = Math.floor(days / 7);
        return `${weeks}w ago`;
    }
}

module.exports = ReportCommands;