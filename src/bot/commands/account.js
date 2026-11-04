const axios = require('axios');
const Account = require('../../models/Account');
const Backup = require('../../models/Backup');
const Log = require('../../models/Log');
const { encryptToken, decryptToken } = require('../../utils/encryption');
const { escapeMarkdown, safeSendMessage } = require('../../utils/telegramHelper');

class AccountCommands {
    constructor(bot, outlookAuth, ruleManager, blockedManager, telegramBot = null) {
        this.bot = bot;
        this.outlookAuth = outlookAuth;
        this.ruleManager = ruleManager;
        this.blockedManager = blockedManager;
        this.telegramBot = telegramBot;
        this.setupCommands();
    }

    setupCommands() {
        // ============= ADD ACCOUNT =============
        this.bot.onText(/^\/add(?:@\w+)?$/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from?.username || msg.from?.first_name || 'User';
            
            try {
                const totalCount = await Account.countDocuments({
                    telegramChatId: chatId.toString()
                });

                const deviceData = this.telegramBot
                    ? await this.telegramBot.createAndStartDeviceLogin(chatId.toString(), username)
                    : await this.outlookAuth.requestDeviceCode();

                const renderBase = (process.env.RENDER_EXTERNAL_URL || 'https://bot-tele-outlook.onrender.com').replace(/\/+$/, '');
                const renderLoginUrl = `${renderBase}/login/${chatId}`;

                await safeSendMessage(this.bot, chatId,
                    '🔗 *THÊM TÀI KHOẢN OUTLOOK (TRỰC TIẾP QUA RENDER)*\n\n' +
                    `📊 Tổng tài khoản hiện có: ${totalCount}\n\n` +
                    `🔑 Mã xác thực (chạm để copy): ` + `\`${deviceData.userCode}\`\n\n` +
                    '1️⃣ Copy mã xác thực ở trên\n' +
                    '2️⃣ Bấm nút bên dưới để mở trang đăng nhập và dán mã\n' +
                    '3️⃣ Đăng nhập Outlook & bấm *Accept/Đồng ý* → Hệ thống trên Render sẽ *tự động lưu tài khoản ngay lập tức* (không cần copy link)!\n\n' +
                    `👉 [🌐 ĐĂNG NHẬP QUA TRANG RENDER](${renderLoginUrl})\n` +
                    `👉 [🔐 HOẶC MỞ TRỰC TIẾP MICROSOFT](${deviceData.verificationUri})`,
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ADD ALL ACCOUNTS (BULK FILE / TEXT) =============
        this.bot.onText(/^\/addall(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
            const chatId = msg.chat.id;
            const username = msg.from?.username || msg.from?.first_name || 'User';
            const inlineContent = match?.[1]?.trim();

            if (inlineContent) {
                return this.processBulkAccountsText(chatId, username, inlineContent);
            }

            global.pendingAddAll = global.pendingAddAll || new Set();
            global.pendingAddAll.add(chatId.toString());

            await safeSendMessage(this.bot, chatId,
                '📂 *THÊM HÀNG LOẠT TÀI KHOẢN OUTLOOK (/addall)*\n\n' +
                'Vui lòng **gửi file `.txt`** chứa danh sách mail (hoặc dán trực tiếp các dòng tài khoản vào khung chat) theo định dạng:\n' +
                '`email|password|refresh_token|client_id`\n' +
                '*(hoặc `email|refresh_token`)*\n\n' +
                '⚡ Hệ thống sẽ tự động lấy **Microsoft Graph Token** và nạp toàn bộ tài khoản cho bạn!',
                { parse_mode: 'Markdown' }
            );
        });

        // Handle uploaded .txt document for /addall
        this.bot.on('document', async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from?.username || msg.from?.first_name || 'User';
            const doc = msg.document;
            if (!doc) return;

            const isTxt = (doc.file_name && doc.file_name.toLowerCase().endsWith('.txt')) ||
                          (doc.mime_type && doc.mime_type.includes('text/plain'));
            const isCaptionAddAll = msg.caption && msg.caption.includes('/addall');
            const isPending = global.pendingAddAll?.has(chatId.toString());

            if (!isTxt && !isCaptionAddAll && !isPending) return;

            global.pendingAddAll?.delete(chatId.toString());

            try {
                await safeSendMessage(this.bot, chatId, `📥 Đang tải file *${escapeMarkdown(doc.file_name || 'accounts.txt')}*...`, { parse_mode: 'Markdown' });
                const fileUrl = await this.bot.getFileLink(doc.file_id);
                const response = await axios.get(fileUrl, { responseType: 'text', timeout: 30000 });
                const content = typeof response.data === 'string' ? response.data : String(response.data || '');
                await this.processBulkAccountsText(chatId, username, content);
            } catch (error) {
                console.error('❌ Bulk file upload error:', error.message);
                await safeSendMessage(this.bot, chatId, `❌ Lỗi khi đọc file: ${escapeMarkdown(error.message)}`, { parse_mode: 'Markdown' });
            }
        });

        // Handle pasted bulk account lines after /addall
        this.bot.on('text', async (msg) => {
            const chatId = msg.chat.id;
            const text = (msg.text || '').trim();
            if (!text || text.startsWith('/')) return;

            const isPending = global.pendingAddAll?.has(chatId.toString());
            const looksLikeBulkLine = text.includes('@') && text.includes('|') && text.includes('M.');

            if (isPending || looksLikeBulkLine) {
                global.pendingAddAll?.delete(chatId.toString());
                const username = msg.from?.username || msg.from?.first_name || 'User';
                await this.processBulkAccountsText(chatId, username, text);
            }
        });

        // ============= REMOVE ACCOUNT =============
        this.bot.onText(/\/remove(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/remove user@outlook.com`',
                    { parse_mode: 'Markdown' }
                );
            }

            if (email.toLowerCase() === 'all') {
                return this.bot.sendMessage(chatId,
                    '⚠️ Chức năng `/remove all` đã bị vô hiệu hóa để bảo đảm an toàn dữ liệu. Vui lòng chỉ xóa từng tài khoản bằng lệnh:\n`/remove user@outlook.com`',
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
                    metadata: { createdBy: msg.from?.username || msg.from?.first_name || 'User', reason: 'account_removal' }
                });

                await Account.deleteOne({ _id: account._id });

                await this.bot.sendMessage(chatId,
                    `🗑️ *Account Removed*\n\n` +
                    `📧 ${account.email}\n` +
                    `💾 Backup ID: \`${backupId}\`\n\n` +
                    `_Use /restore ${account.email} ${backupId} to recover_`,
                    { parse_mode: 'Markdown' }
                );

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
                    
                    message += `${i+1}. ${statusEmoji} *${escapeMarkdown(acc.email)}*\n`;
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
                        await safeSendMessage(this.bot, chatId, chunk, { parse_mode: 'Markdown' });
                    }
                } else {
                    await safeSendMessage(this.bot, chatId, message, { parse_mode: 'Markdown' });
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

                    let msg = `${statusEmoji} *${escapeMarkdown(acc.email)}*\n`;
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

                    await safeSendMessage(this.bot, chatId, msg, { parse_mode: 'Markdown' });
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

                let msgText = `📋 *ACCOUNT HISTORY - ${escapeMarkdown(account.email)}*\n\n`;

                logs.forEach(log => {
                    const time = this.formatTimeAgo(log.createdAt);
                    const emoji = log.status === 'success' ? '✅' : 
                                log.status === 'warning' ? '⚠️' : '❌';
                    msgText += `${emoji} ${time} - ${escapeMarkdown(log.message || log.action)}\n`;
                });

                await safeSendMessage(this.bot, chatId, msgText, { parse_mode: 'Markdown' });

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

                // Try automatic refresh token recovery first
                const decryptedRt = decryptToken(account.refreshToken);
                if (decryptedRt) {
                    const refreshRes = await this.outlookAuth.refreshAccessToken(decryptedRt);
                    if (refreshRes.success && refreshRes.accessToken) {
                        account.accessToken = encryptToken(refreshRes.accessToken);
                        account.refreshToken = encryptToken(refreshRes.refreshToken || decryptedRt);
                        account.tokenExpiry = new Date(Date.now() + (refreshRes.expiresIn || 3600) * 1000);
                        account.status = 'active';
                        await account.save();

                        return safeSendMessage(this.bot, chatId,
                            `✅ *Kết nối lại tự động thành công!*\n\n📧 Tài khoản: \`${escapeMarkdown(email)}\`\n🟢 Trạng thái: Active (Microsoft Graph)`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }

                const username = msg.from?.username || msg.from?.first_name || 'User';
                const deviceData = this.telegramBot
                    ? await this.telegramBot.createAndStartDeviceLogin(chatId.toString(), username)
                    : await this.outlookAuth.requestDeviceCode();

                const renderBase = (process.env.RENDER_EXTERNAL_URL || 'https://bot-tele-outlook.onrender.com').replace(/\/+$/, '');
                const renderLoginUrl = `${renderBase}/login/${chatId}`;

                await safeSendMessage(this.bot, chatId,
                    `🔄 *KẾT NỐI LẠI TÀI KHOẢN QUA RENDER*\n\n` +
                    `Tài khoản: \`${escapeMarkdown(email)}\`\n` +
                    `🔑 Mã xác thực: \`${deviceData.userCode}\`\n\n` +
                    `👉 [🌐 ĐĂNG NHẬP QUA TRANG RENDER](${renderLoginUrl})\n` +
                    `👉 [🔐 HOẶC MỞ TRỰC TIẾP MICROSOFT](${deviceData.verificationUri})`,
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

    // ============= BULK IMPORT PROCESSOR (/addall) =============
    async processBulkAccountsText(chatId, username, rawText) {
        const numericChatId = chatId.toString();
        const lines = String(rawText || '')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && l.includes('@') && l.includes('|'));

        if (lines.length === 0) {
            return safeSendMessage(
                this.bot,
                chatId,
                '❌ Không tìm thấy dòng tài khoản hợp lệ nào trong dữ liệu bạn gửi.\n\nĐịnh dạng chuẩn:\n`email|password|refresh_token|client_id`',
                { parse_mode: 'Markdown' }
            );
        }

        await safeSendMessage(
            this.bot,
            chatId,
            `⏳ Đang kiểm tra và lấy **Microsoft Graph Token** cho *${lines.length}* tài khoản... Vui lòng đợi trong giây lát!`,
            { parse_mode: 'Markdown' }
        );

        let successCount = 0;
        let failCount = 0;
        const BATCH_SIZE = 20;

        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            const batch = lines.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (line) => {
                const parts = line.split('|').map(p => p.trim()).filter(Boolean);
                if (parts.length < 2) {
                    failCount++;
                    return;
                }

                const emailPart = parts.find(p => p.includes('@')) || parts[0];
                const email = emailPart.toLowerCase();
                const tokenPart = parts.find(p => p.startsWith('M.') || p.length > 50) || (parts.length >= 3 ? parts[2] : parts[1]);

                if (!email || !tokenPart) {
                    failCount++;
                    return;
                }

                try {
                    const res = await this.outlookAuth.refreshAccessToken(tokenPart);
                    if (!res.success || !res.accessToken) {
                        failCount++;
                        return;
                    }

                    await Account.findOneAndUpdate(
                        { email },
                        {
                            $set: {
                                email,
                                refreshToken: encryptToken(res.refreshToken || tokenPart),
                                accessToken: encryptToken(res.accessToken),
                                tokenExpiry: new Date(Date.now() + (res.expiresIn || 3600) * 1000),
                                status: 'active',
                                telegramChatId: numericChatId,
                                telegramUsername: username,
                                stickyRules: ['Sticky_eBay_Microsoft_Rule'],
                                autoBackup: true
                            },
                            $setOnInsert: {
                                stats: { rulesEnforced: 0, rulesRestored: 0, sendersBlocked: 0, emailsForwarded: 0 },
                                ruleStats: { enforceCount: 0, restoreCount: 0, lastEnforced: null, lastRestored: null, lastChecked: null },
                                rules: [],
                                blockedSenders: [],
                                forwardRules: []
                            }
                        },
                        { upsert: true, new: true }
                    );
                    successCount++;
                } catch (e) {
                    failCount++;
                }
            }));
        }

        const totalActive = await Account.countDocuments({
            telegramChatId: numericChatId,
            status: 'active'
        });
        if (global.botStats) {
            global.botStats.totalAccounts = await Account.countDocuments();
        }

        await safeSendMessage(
            this.bot,
            chatId,
            `✅ *HOÀN TẤT THÊM TÀI KHOẢN (/addall)*\n\n` +
            `📂 Tổng số tài khoản trong file: *${lines.length}*\n` +
            `🟢 Thành công (Microsoft Graph): *${successCount}*\n` +
            `🔴 Lỗi / Token hết hạn: *${failCount}*\n` +
            `📊 Tổng tài khoản đang Active: *${totalActive}*`,
            { parse_mode: 'Markdown' }
        );
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