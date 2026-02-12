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
                
                const accounts = await Account.find({ telegramChatId: chatId.toString() });
                
                const todayLogs = await Log.find({
                    accountId: { $in: accounts.map(a => a._id) },
                    createdAt: { $gte: today }
                });

                const stats = {
                    rulesEnforced: todayLogs.filter(l => l.action === 'rule_verified').length,
                    rulesRestored: todayLogs.filter(l => ['rule_restored', 'rule_created'].includes(l.action)).length,
                    sendersBlocked: todayLogs.filter(l => l.action === 'sender_blocked').length,
                    sendersUnblocked: todayLogs.filter(l => l.action === 'sender_unblocked').length,
                    errors: todayLogs.filter(l => l.status === 'failure').length
                };

                const reportId = `daily_${Date.now()}`;
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

                let reportMsg = `📊 *DAILY REPORT - ${today.toLocaleDateString()}*\n\n`;
                
                reportMsg += `📧 *Accounts*\n`;
                reportMsg += `├ Total: ${accounts.length}\n`;
                reportMsg += `├ Active: ${accounts.filter(a => a.status === 'active').length}\n`;
                reportMsg += `└ Reconnect: ${accounts.filter(a => a.status === 'reconnect_needed').length}\n\n`;
                
                reportMsg += `🛡️ *Rules*\n`;
                reportMsg += `├ Enforced: ${stats.rulesEnforced}\n`;
                reportMsg += `└ Restored: ${stats.rulesRestored}\n\n`;
                
                reportMsg += `🚫 *Senders*\n`;
                reportMsg += `├ Blocked: ${stats.sendersBlocked}\n`;
                reportMsg += `└ Unblocked: ${stats.sendersUnblocked}\n\n`;
                
                reportMsg += `❌ *Errors*\n`;
                reportMsg += `└ Total: ${stats.errors}\n\n`;
                
                reportMsg += `✅ *System Status: Operational*\n`;
                reportMsg += `🕐 Report generated: ${new Date().toLocaleTimeString()}`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= WEEKLY REPORT =============
        this.bot.onText(/\/report weekly/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                
                const accounts = await Account.find({ telegramChatId: chatId.toString() });
                
                const weekLogs = await Log.find({
                    accountId: { $in: accounts.map(a => a._id) },
                    createdAt: { $gte: weekAgo }
                });

                const dailyStats = {};
                for (let i = 0; i < 7; i++) {
                    const date = new Date();
                    date.setDate(date.getDate() - i);
                    date.setHours(0, 0, 0, 0);
                    const dateStr = date.toLocaleDateString();
                    
                    const dayLogs = weekLogs.filter(l => {
                        const logDate = new Date(l.createdAt);
                        logDate.setHours(0, 0, 0, 0);
                        return logDate.getTime() === date.getTime();
                    });
                    
                    dailyStats[dateStr] = {
                        rules: dayLogs.filter(l => l.action.includes('rule')).length,
                        blocks: dayLogs.filter(l => l.action.includes('block')).length,
                        errors: dayLogs.filter(l => l.status === 'failure').length
                    };
                }

                let reportMsg = `📊 *WEEKLY REPORT - Last 7 Days*\n\n`;
                
                reportMsg += `📧 *Accounts*\n`;
                reportMsg += `├ New: ${accounts.filter(a => a.createdAt >= weekAgo).length}\n`;
                reportMsg += `├ Total: ${accounts.length}\n`;
                reportMsg += `└ Active: ${accounts.filter(a => a.status === 'active').length}\n\n`;
                
                reportMsg += `📈 *Daily Activity*\n`;
                Object.keys(dailyStats).reverse().forEach(date => {
                    reportMsg += `├ ${date}: `;
                    reportMsg += `📋${dailyStats[date].rules} `;
                    reportMsg += `🚫${dailyStats[date].blocks} `;
                    reportMsg += `❌${dailyStats[date].errors}\n`;
                });
                reportMsg += `\n`;

                const totals = {
                    rules: weekLogs.filter(l => l.action.includes('rule')).length,
                    blocks: weekLogs.filter(l => l.action.includes('block')).length,
                    errors: weekLogs.filter(l => l.status === 'failure').length
                };

                reportMsg += `📊 *Totals*\n`;
                reportMsg += `├ Rules: ${totals.rules}\n`;
                reportMsg += `├ Blocks: ${totals.blocks}\n`;
                reportMsg += `└ Errors: ${totals.errors}\n`;

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ACCOUNT REPORT =============
        this.bot.onText(/\/report (?:\s+(.+))/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match[1];

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
                    .limit(20);

                const backups = await Backup.find({ accountId: account._id })
                    .sort({ createdAt: -1 })
                    .limit(5);

                let reportMsg = `📊 *ACCOUNT REPORT - ${account.email}*\n\n`;
                
                reportMsg += `📧 *Status*\n`;
                reportMsg += `├ Added: ${account.createdAt.toLocaleDateString()}\n`;
                reportMsg += `├ Status: ${account.status}\n`;
                reportMsg += `├ Last Active: ${account.lastActive?.toLocaleString() || 'Never'}\n`;
                reportMsg += `└ Last Check: ${account.lastChecked?.toLocaleString() || 'Never'}\n\n`;
                
                reportMsg += `📋 *Rules*\n`;
                reportMsg += `├ Total: ${account.rules?.length || 0}\n`;
                reportMsg += `├ Sticky: ${account.rules?.filter(r => r.isSticky).length || 0}\n`;
                reportMsg += `└ Enforced: ${account.stats?.rulesEnforced || 0}\n\n`;
                
                reportMsg += `🚫 *Blocked Senders*\n`;
                reportMsg += `├ Total: ${account.blockedSenders?.length || 0}\n`;
                reportMsg += `└ Blocked: ${account.stats?.sendersBlocked || 0}\n\n`;
                
                reportMsg += `📨 *Forward Rules*\n`;
                reportMsg += `└ Total: ${account.forwardRules?.length || 0}\n\n`;
                
                reportMsg += `💾 *Backups*\n`;
                reportMsg += `├ Auto Backup: ${account.autoBackup ? '✅' : '❌'}\n`;
                reportMsg += `└ Total: ${backups.length}\n\n`;
                
                reportMsg += `📈 *Recent Activity*\n`;
                logs.slice(0, 5).forEach(log => {
                    const time = this.formatTimeAgo(log.createdAt);
                    const emoji = log.status === 'success' ? '✅' : 
                                log.status === 'warning' ? '⚠️' : '❌';
                    reportMsg += `├ ${emoji} ${time} - ${log.message || log.action}\n`;
                });

                await this.bot.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= SUMMARY =============
        this.bot.onText(/\/summary/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const accounts = await Account.find({ telegramChatId: chatId.toString() });
                
                const total = accounts.length;
                const active = accounts.filter(a => a.status === 'active').length;
                const reconnect = accounts.filter(a => a.status === 'reconnect_needed').length;
                
                const totalRules = accounts.reduce((sum, a) => sum + (a.rules?.length || 0), 0);
                const totalBlocked = accounts.reduce((sum, a) => sum + (a.blockedSenders?.length || 0), 0);
                const totalForward = accounts.reduce((sum, a) => sum + (a.forwardRules?.length || 0), 0);
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const todayAccounts = accounts.filter(a => a.createdAt >= today).length;
                const todayLogs = await Log.countDocuments({
                    accountId: { $in: accounts.map(a => a._id) },
                    createdAt: { $gte: today }
                });

                let summaryMsg = `📊 *QUICK SUMMARY*\n\n`;
                summaryMsg += `📧 *Accounts*\n`;
                summaryMsg += `├ Total: ${total}\n`;
                summaryMsg += `├ Active: ${active}\n`;
                summaryMsg += `├ Reconnect: ${reconnect}\n`;
                summaryMsg += `└ Added Today: ${todayAccounts}\n\n`;
                
                summaryMsg += `📋 *Configuration*\n`;
                summaryMsg += `├ Rules: ${totalRules}\n`;
                summaryMsg += `├ Blocked: ${totalBlocked}\n`;
                summaryMsg += `└ Forward: ${totalForward}\n\n`;
                
                summaryMsg += `📈 *Today*\n`;
                summaryMsg += `└ Activities: ${todayLogs}\n`;

                await this.bot.sendMessage(chatId, summaryMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= STATS =============
        this.bot.onText(/\/stats/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const accounts = await Account.find({ telegramChatId: chatId.toString() });
                
                const total = accounts.length;
                const active = accounts.filter(a => a.status === 'active').length;
                
                const totalRules = accounts.reduce((sum, a) => sum + (a.rules?.length || 0), 0);
                const totalBlocked = accounts.reduce((sum, a) => sum + (a.blockedSenders?.length || 0), 0);
                const totalForward = accounts.reduce((sum, a) => sum + (a.forwardRules?.length || 0), 0);
                
                const totalRestored = accounts.reduce((sum, a) => sum + (a.stats?.rulesRestored || 0), 0);
                const totalBlocks = accounts.reduce((sum, a) => sum + (a.stats?.sendersBlocked || 0), 0);
                
                const uptime = process.uptime();
                const days = Math.floor(uptime / 86400);
                const hours = Math.floor((uptime % 86400) / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);

                let statsMsg = `📊 *BOT STATISTICS*\n\n`;
                
                statsMsg += `🤖 *System*\n`;
                statsMsg += `├ Uptime: ${days}d ${hours}h ${minutes}m\n`;
                statsMsg += `├ Accounts: ${total}\n`;
                statsMsg += `├ Active: ${active}\n`;
                statsMsg += `└ Reconnect: ${total - active}\n\n`;
                
                statsMsg += `📋 *Configuration*\n`;
                statsMsg += `├ Total Rules: ${totalRules}\n`;
                statsMsg += `├ Blocked Senders: ${totalBlocked}\n`;
                statsMsg += `└ Forward Rules: ${totalForward}\n\n`;
                
                statsMsg += `📈 *Activity*\n`;
                statsMsg += `├ Rules Restored: ${totalRestored}\n`;
                statsMsg += `└ Senders Blocked: ${totalBlocks}\n`;

                await this.bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });

            } catch (error) {
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
                    });
                } else {
                    accounts = await Account.find({ 
                        telegramChatId: chatId.toString() 
                    }).limit(3);
                }

                if (accounts.length === 0) {
                    return this.bot.sendMessage(chatId, '📭 No accounts found.');
                }

                for (const account of accounts) {
                    const logs = await Log.find({ accountId: account._id })
                        .sort({ createdAt: -1 })
                        .limit(10);

                    if (logs.length > 0) {
                        let logMsg = `📋 *Recent Activity - ${account.email}*\n\n`;
                        
                        logs.forEach(log => {
                            const time = this.formatTimeAgo(log.createdAt);
                            const emoji = log.status === 'success' ? '✅' : 
                                        log.status === 'warning' ? '⚠️' : '❌';
                            logMsg += `${emoji} ${time} - ${log.message || log.action}\n`;
                        });

                        await this.bot.sendMessage(chatId, logMsg, { parse_mode: 'Markdown' });
                    }
                }

            } catch (error) {
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
                const accounts = await Account.find({ telegramChatId: chatId.toString() });
                
                let exportData = {};
                let fileName = `outlook_bot_export_${Date.now()}`;
                
                if (format === 'json') {
                    exportData = {
                        exportDate: new Date().toISOString(),
                        totalAccounts: accounts.length,
                        accounts: accounts.map(a => ({
                            email: a.email,
                            status: a.status,
                            createdAt: a.createdAt,
                            rules: a.rules,
                            blockedSenders: a.blockedSenders,
                            forwardRules: a.forwardRules,
                            stats: a.stats
                        }))
                    };
                    
                    const jsonStr = JSON.stringify(exportData, null, 2);
                    await this.bot.sendDocument(chatId, Buffer.from(jsonStr), {
                        filename: `${fileName}.json`,
                        caption: `📊 Export completed: ${accounts.length} accounts`
                    });
                    
                } else if (format === 'csv') {
                    let csv = 'Email,Status,Created,Rules,Blocked,Forwards\n';
                    accounts.forEach(a => {
                        csv += `${a.email},${a.status},${a.createdAt.toLocaleDateString()},${a.rules?.length || 0},${a.blockedSenders?.length || 0},${a.forwardRules?.length || 0}\n`;
                    });
                    
                    await this.bot.sendDocument(chatId, Buffer.from(csv), {
                        filename: `${fileName}.csv`,
                        caption: `📊 Export completed: ${accounts.length} accounts`
                    });
                    
                } else {
                    let txt = `OUTLOOK BOT EXPORT - ${new Date().toLocaleString()}\n`;
                    txt += `================================\n\n`;
                    txt += `Total Accounts: ${accounts.length}\n\n`;
                    
                    accounts.forEach((a, i) => {
                        txt += `Account ${i+1}: ${a.email}\n`;
                        txt += `Status: ${a.status}\n`;
                        txt += `Rules: ${a.rules?.length || 0}\n`;
                        txt += `Blocked: ${a.blockedSenders?.length || 0}\n`;
                        txt += `Forward: ${a.forwardRules?.length || 0}\n`;
                        txt += `Added: ${a.createdAt.toLocaleDateString()}\n`;
                        txt += `--------------------------------\n\n`;
                    });
                    
                    await this.bot.sendDocument(chatId, Buffer.from(txt), {
                        filename: `${fileName}.txt`,
                        caption: `📊 Export completed: ${accounts.length} accounts`
                    });
                }

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
}

module.exports = ReportCommands;