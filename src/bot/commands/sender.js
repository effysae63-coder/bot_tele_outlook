// src/bot/commands/sender.js
const Account = require('../../models/Account');
const Log = require('../../models/Log');
const { decryptToken } = require('../../utils/encryption');

class SenderCommands {
    constructor(bot, outlookAuth, blockedManager, ruleManager) {
        this.bot = bot;
        this.outlookAuth = outlookAuth;
        this.blockedManager = blockedManager;
        this.ruleManager = ruleManager;
        this.TARGET_EMAIL = process.env.FORWARD_TARGET_EMAIL || 'neg4pos@gmail.com';
        
        // Bind methods
        this.enableForward = this.enableForward.bind(this);
        this.disableForward = this.disableForward.bind(this);
        this.blockDomain = this.blockDomain.bind(this);
        this.unblockDomain = this.unblockDomain.bind(this);
        
        this.setupCommands();
    }

    setupCommands() {
        // ============= BLOCK ANY SENDER/DOMAIN =============
        this.bot.onText(/\/block (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const sender = match[1].trim().toLowerCase();

            if (!sender) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/block spammer@example.com`\n' +
                    '       `/block @ebay.com` - Block entire domain\n' +
                    '       `/block all:spammer@example.com` - Block on ALL accounts',
                    { parse_mode: 'Markdown' }
                );
            }

            await this.blockDomain(chatId, sender, msg.from);
        });

        // ============= UNBLOCK ANY SENDER/DOMAIN =============
        this.bot.onText(/\/unblock (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const sender = match[1].trim().toLowerCase();

            if (!sender) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/unblock spammer@example.com`\n' +
                    '       `/unblock @ebay.com` - Unblock entire domain',
                    { parse_mode: 'Markdown' }
                );
            }

            await this.unblockDomain(chatId, sender, msg.from);
        });

        // ============= FORWARD ANY SENDER/DOMAIN =============
        this.bot.onText(/\/forward (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const args = match[1].trim().split(' ');

            if (args.length < 1) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/forward @ebay.com neg4pos@gmail.com`\n' +
                    '       `/forward spam@example.com target@gmail.com`\n' +
                    '       `/forward off @ebay.com` - Disable forwarding',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                if (args[0] === 'off') {
                    const sender = args[1];
                    if (!sender) {
                        return this.bot.sendMessage(chatId, '❌ Please specify sender to disable forwarding for.');
                    }
                    await this.disableForward(chatId, sender);
                } else {
                    const sender = args[0];
                    const targetEmail = args[1] || this.TARGET_EMAIL;
                    await this.enableForward(chatId, sender, targetEmail);
                }
            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= BLOCKED LIST =============
        this.bot.onText(/\/blocked(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            try {
                let query = { telegramChatId: chatId.toString(), status: 'active' };
                if (email) {
                    query.email = email.toLowerCase();
                }

                const accounts = await Account.find(query);

                if (accounts.length === 0) {
                    return this.bot.sendMessage(chatId, '📭 No active accounts found.');
                }

                let message = '🚫 *BLOCKED SENDERS*\n\n';

                for (const account of accounts) {
                    if (account.blockedSenders?.length > 0) {
                        message += `📧 *${account.email}*\n`;
                        message += `└ Total: ${account.blockedSenders.length}\n`;
                        
                        account.blockedSenders.slice(0, 10).forEach((s, i) => {
                            message += `  ${i+1}. \`${s}\`\n`;
                        });
                        
                        if (account.blockedSenders.length > 10) {
                            message += `  └ ... and ${account.blockedSenders.length - 10} more\n`;
                        }
                        message += `\n`;
                    }
                }

                await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= CHECK DOMAIN STATUS =============
        this.bot.onText(/\/check (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const domain = match[1].trim().toLowerCase();

            try {
                const accounts = await Account.find({
                    telegramChatId: chatId.toString(),
                    status: 'active'
                });

                if (accounts.length === 0) {
                    return this.bot.sendMessage(chatId, '❌ No active accounts found.');
                }

                await this.bot.sendMessage(chatId,
                    `🔍 *Checking \`${domain}\` on ${accounts.length} accounts...*`,
                    { parse_mode: 'Markdown' }
                );

                let blocked = 0;
                let forwarded = 0;
                let notConfigured = 0;

                for (const account of accounts) {
                    try {
                        const refreshToken = decryptToken(account.refreshToken);
                        const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                        
                        if (tokenResult.success) {
                            const isBlocked = account.blockedSenders?.includes(domain) || false;
                            const hasForward = account.forwardRules?.some(r => r.sender === domain) || false;
                            
                            if (isBlocked) blocked++;
                            if (hasForward) forwarded++;
                            if (!isBlocked && !hasForward) notConfigured++;
                        }
                    } catch (err) {
                        console.error(`Failed to check ${account.email}:`, err);
                    }
                }

                let statusMsg = `📋 *Domain Status: ${domain}*\n\n`;
                statusMsg += `📧 Total Accounts: ${accounts.length}\n\n`;
                statusMsg += `🚫 Blocked: ${blocked} accounts\n`;
                statusMsg += `📨 Forwarded to ${this.TARGET_EMAIL}: ${forwarded} accounts\n`;
                statusMsg += `⚪ Not Configured: ${notConfigured} accounts\n\n`;

                await this.bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });
    }

    // ============= BLOCK DOMAIN METHOD =============
    async blockDomain(chatId, sender, user) {
        try {
            let accounts;
            let isAllAccounts = sender.startsWith('all:');
            let blockTarget = isAllAccounts ? sender.substring(4) : sender;

            if (isAllAccounts) {
                accounts = await Account.find({
                    telegramChatId: chatId.toString(),
                    status: 'active'
                });
            } else {
                if (sender.includes('|')) {
                    const [accountEmail, blockSender] = sender.split('|');
                    accounts = await Account.find({
                        email: accountEmail.toLowerCase(),
                        telegramChatId: chatId.toString(),
                        status: 'active'
                    });
                    blockTarget = blockSender;
                } else {
                    accounts = await Account.find({
                        telegramChatId: chatId.toString(),
                        status: 'active'
                    });
                    blockTarget = sender;
                }
            }

            if (accounts.length === 0) {
                return this.bot.sendMessage(chatId, '❌ No active accounts found.');
            }

            const statusMsg = await this.bot.sendMessage(chatId,
                `🚫 *Blocking \`${blockTarget}\` on ${accounts.length} accounts...*`,
                { parse_mode: 'Markdown' }
            );

            let success = 0;
            let failed = 0;

            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[i];
                
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (tokenResult.success) {
                        await this.blockedManager.addBlockedSender(
                            tokenResult.accessToken,
                            account._id,
                            blockTarget
                        );

                        if (!account.blockedSenders) account.blockedSenders = [];
                        if (!account.blockedSenders.includes(blockTarget)) {
                            account.blockedSenders.push(blockTarget);
                        }
                        
                        account.stats.sendersBlocked = (account.stats.sendersBlocked || 0) + 1;
                        await account.save();

                        await Log.create({
                            accountId: account._id,
                            action: 'sender_blocked',
                            status: 'success',
                            message: `Blocked ${blockTarget}`,
                            details: { sender: blockTarget, via: 'command', user: user?.username }
                        });

                        success++;
                    } else {
                        failed++;
                    }
                } catch (err) {
                    failed++;
                }

                if ((i + 1) % 3 === 0 || i === accounts.length - 1) {
                    await this.bot.editMessageText(
                        `🚫 *Blocking \`${blockTarget}\`*\n` +
                        `✅ Success: ${success}/${accounts.length}\n` +
                        `❌ Failed: ${failed}`,
                        {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                }
            }

            await this.bot.sendMessage(chatId,
                `✅ *Blocked Successfully*\n\n` +
                `🚫 Sender: \`${blockTarget}\`\n` +
                `📧 Accounts: ${success}/${accounts.length}\n\n` +
                `_Use /unblock ${blockTarget} to remove block_`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    // ============= UNBLOCK DOMAIN METHOD =============
    async unblockDomain(chatId, sender, user) {
        try {
            let accounts;
            let isAllAccounts = sender.startsWith('all:');
            let unblockTarget = isAllAccounts ? sender.substring(4) : sender;

            if (isAllAccounts) {
                accounts = await Account.find({
                    telegramChatId: chatId.toString(),
                    status: 'active'
                });
            } else {
                accounts = await Account.find({
                    telegramChatId: chatId.toString(),
                    status: 'active'
                });
                unblockTarget = sender;
            }

            if (accounts.length === 0) {
                return this.bot.sendMessage(chatId, '❌ No active accounts found.');
            }

            const statusMsg = await this.bot.sendMessage(chatId,
                `✅ *Unblocking \`${unblockTarget}\` on ${accounts.length} accounts...*`,
                { parse_mode: 'Markdown' }
            );

            let success = 0;
            let failed = 0;

            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[i];
                
                try {
                    const refreshToken = decryptToken(account.refreshToken);
                    const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                    
                    if (tokenResult.success) {
                        await this.blockedManager.removeBlockedSender(
                            tokenResult.accessToken,
                            account._id,
                            unblockTarget
                        );

                        if (account.blockedSenders) {
                            account.blockedSenders = account.blockedSenders.filter(s => s !== unblockTarget);
                        }
                        await account.save();

                        await Log.create({
                            accountId: account._id,
                            action: 'sender_unblocked',
                            status: 'success',
                            message: `Unblocked ${unblockTarget}`,
                            details: { sender: unblockTarget, user: user?.username }
                        });

                        success++;
                    } else {
                        failed++;
                    }
                } catch (err) {
                    failed++;
                }

                if ((i + 1) % 3 === 0 || i === accounts.length - 1) {
                    await this.bot.editMessageText(
                        `✅ *Unblocking \`${unblockTarget}\`*\n` +
                        `✅ Success: ${success}/${accounts.length}\n` +
                        `❌ Failed: ${failed}`,
                        {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                }
            }

            await this.bot.sendMessage(chatId,
                `✅ *Unblocked Successfully*\n\n` +
                `📧 Sender: \`${unblockTarget}\`\n` +
                `📊 Accounts: ${success}/${accounts.length}`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    // ============= ENABLE FORWARD METHOD =============
async enableForward(chatId, sender, targetEmail) {
    const accounts = await Account.find({
        telegramChatId: chatId.toString(),
        status: 'active'
    });

    if (accounts.length === 0) {
        return this.bot.sendMessage(chatId, '❌ No active accounts found.');
    }

    await this.bot.sendMessage(chatId,
        `📨 *Creating forward rule*\n` +
        `└ Sender: \`${sender}\`\n` +
        `└ Target: \`${targetEmail}\`\n` +
        `└ Accounts: ${accounts.length}`,
        { parse_mode: 'Markdown' }
    );

    let success = 0;
    let failed = 0;

for (const account of accounts) {
    try {
        const refreshToken = decryptToken(account.refreshToken);
        const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
        
        if (tokenResult.success) {
            // ✅ CLEAN RULE NAME
            const cleanSender = sender.replace(/[@.]/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            const cleanTarget = targetEmail.replace(/[@.]/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            const ruleName = `Forward_${cleanSender}_to_${cleanTarget}`;
            
// ✅ FIXED - Use 'from' condition for exact sender match!
const rule = {
    displayName: ruleName,
    sequence: 999,
    isEnabled: true,
    conditions: {
        from: {  // ✅ More reliable than subjectContains!
            emailAddresses: [
                {
                    address: sender
                }
            ]
        }
    },
    actions: {
        forwardTo: [
            {
                emailAddress: {
                    address: targetEmail
                }
            }
        ],
        delete: true,
        markAsRead: true,
        stopProcessingRules: true
    }
};

            console.log('📤 Creating forward+delete rule:', JSON.stringify(rule, null, 2));

            // Check if rule exists
            const existingRules = await this.ruleManager.getRules(tokenResult.accessToken);
            const existingRule = existingRules.find(r => r.displayName === ruleName);
            
            if (existingRule) {
                await this.ruleManager.updateRule(
                    tokenResult.accessToken,
                    existingRule.id,
                    rule
                );
                console.log('✅ Forward+Delete rule updated');
            } else {
                await this.ruleManager.createCustomRule(
                    tokenResult.accessToken,
                    account._id,
                    rule
                );
                console.log('✅ Forward+Delete rule created');
            }

            // Database update
            account.forwardRules = account.forwardRules || [];
            
            const existingForwardRule = account.forwardRules.find(
                r => r.sender === sender && r.targetEmail === targetEmail
            );
            
            if (!existingForwardRule) {
                account.forwardRules.push({
                    sender,
                    targetEmail,
                    action: 'forward_delete',  // 🔥 Action update
                    createdAt: new Date(),
                    isActive: true
                });
            }
            
            await account.save();
            success++;
        } else {
            failed++;
        }
    } catch (err) {
        console.error(`❌ Forward rule error for ${account.email}:`, err.message);
        failed++;
    }
}

    await this.bot.sendMessage(chatId,
        `✅ *Forward Rule Created*\n\n` +
        `📧 From: \`${sender}\`\n` +
        `📨 To: \`${targetEmail}\`\n` +
        `✅ Success: ${success}/${accounts.length}\n` +
        `❌ Failed: ${failed}`,
        { parse_mode: 'Markdown' }
    );
}

// ============= DISABLE FORWARD METHOD - FIXED =============
async disableForward(chatId, sender, targetEmail = null) {
    const accounts = await Account.find({
        telegramChatId: chatId.toString(),
        status: 'active'
    });

    if (accounts.length === 0) {
        return this.bot.sendMessage(chatId, '❌ No active accounts found.');
    }

    let success = 0;
    let failed = 0;
    let removedRules = [];

    for (const account of accounts) {
        try {
            const refreshToken = decryptToken(account.refreshToken);
            const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
            
            if (tokenResult.success) {
                let rulesToRemove = [];
                
                if (targetEmail) {
                    // ✅ SPECIFIC TARGET WALA FORWARD HATAO
                    rulesToRemove = account.forwardRules?.filter(r => 
                        r.sender === sender && r.targetEmail === targetEmail
                    ) || [];
                } else {
                    // ✅ SENDER KI SARI FORWARD RULES HATAO
                    rulesToRemove = account.forwardRules?.filter(r => r.sender === sender) || [];
                }

                for (const rule of rulesToRemove) {
                    const ruleName = `Forward_${sender.replace(/[@.]/g, '_')}_to_${rule.targetEmail.replace(/[@.]/g, '_')}`;
                    try {
                        await this.ruleManager.removeRule(tokenResult.accessToken, ruleName);
                        removedRules.push(`${sender} → ${rule.targetEmail}`);
                    } catch (err) {
                        // Rule might not exist
                    }
                }

                // Database update - SPECIFIC RULE HATAO
                if (targetEmail) {
                    account.forwardRules = account.forwardRules?.filter(r => 
                        !(r.sender === sender && r.targetEmail === targetEmail)
                    ) || [];
                } else {
                    account.forwardRules = account.forwardRules?.filter(r => r.sender !== sender) || [];
                }
                
                await account.save();
                success++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`❌ Disable forward error for ${account.email}:`, err);
            failed++;
        }
    }

    let message = `✅ *Forward Rules Disabled*\n\n`;
    if (targetEmail) {
        message += `📧 Removed: \`${sender} → ${targetEmail}\`\n`;
    } else {
        message += `📧 Sender: \`${sender}\`\n`;
        message += `📋 Removed: ${removedRules.length} rule(s)\n`;
    }
    message += `✅ Success: ${success}/${accounts.length}\n`;
    message += `❌ Failed: ${failed}`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}
}

module.exports = SenderCommands;