// src/bot/commands/rules.js
const Account = require('../../models/Account');
const Log = require('../../models/Log');
const { decryptToken } = require('../../utils/encryption');

class RuleCommands {
    constructor(bot, outlookAuth, ruleManager) {
        this.bot = bot;
        this.outlookAuth = outlookAuth;
        this.ruleManager = ruleManager;
        this.setupCommands();
    }

    setupCommands() {
        // ============= LIST ALL RULES =============
        this.bot.onText(/\/rules(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rules user@outlook.com`',
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
                    return this.bot.sendMessage(chatId, `❌ Failed to connect to account.`);
                }

                const rules = await this.ruleManager.getRules(tokenResult.accessToken);

                let msgText = `📋 *RULES - ${account.email}*\n\n`;

                if (rules.length === 0) {
                    msgText += `No rules found.`;
                } else {
                    rules.forEach((rule, index) => {
                        const stickyMark = account.stickyRules?.includes(rule.displayName) ? ' 🔒' : '';
                        const enabledMark = rule.isEnabled ? '✅' : '❌';
                        msgText += `${index + 1}. ${enabledMark} *${rule.displayName}*${stickyMark}\n`;
                        
                        if (rule.conditions) {
                            msgText += `   └ Conditions: `;
                            if (rule.conditions.subjectContains) {
                                msgText += `Subject contains ${rule.conditions.subjectContains.join(', ')} `;
                            }
                            if (rule.conditions.bodyContains) {
                                msgText += `Body contains ${rule.conditions.bodyContains.join(', ')} `;
                            }
                            if (rule.conditions.senderContains) {
                                msgText += `Sender contains ${rule.conditions.senderContains.join(', ')} `;
                            }
                            msgText += `\n`;
                        }
                        
                        if (rule.actions) {
                            msgText += `   └ Actions: `;
                            if (rule.actions.delete) msgText += `Delete `;
                            if (rule.actions.forwardTo) msgText += `→ ${rule.actions.forwardTo[0]?.emailAddress?.address} `;
                            if (rule.actions.markAsRead) msgText += `MarkRead `;
                            if (rule.actions.stopProcessingRules) msgText += `Stop `;
                            msgText += `\n`;
                        }
                        msgText += `\n`;
                    });
                }

                await this.bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= ADD CUSTOM RULE =============
        this.bot.onText(/\/rule add (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const args = match[1].split('|').map(s => s.trim());
            
            if (args.length < 3) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rule add RuleName | email@outlook.com | condition:value | action:value`\n\n' +
                    '*Examples:*\n' +
                    '`/rule add BlockShopify | user@outlook.com | sender:shopify.com | action:delete`\n' +
                    '`/rule add ForwardAmazon | user@outlook.com | subject:amazon | forward:neg4pos@gmail.com`\n' +
                    '`/rule add eBaySticky | user@outlook.com | subject:eBay | actions:delete,forward:neg4pos@gmail.com,markread,stop`',
                    { parse_mode: 'Markdown' }
                );
            }

            try {
                const ruleName = args[0];
                const email = args[1].toLowerCase();
                const conditions = [];
                const actions = [];

                for (let i = 2; i < args.length; i++) {
                    const [key, value] = args[i].split(':');
                    if (key === 'subject') conditions.push({ subjectContains: [value] });
                    if (key === 'body') conditions.push({ bodyContains: [value] });
                    if (key === 'sender') conditions.push({ senderContains: [value] });
                    if (key === 'forward') actions.push({ forwardTo: value });
                    if (key === 'action') {
                        if (value === 'delete') actions.push({ delete: true });
                        if (value === 'markread') actions.push({ markAsRead: true });
                        if (value === 'stop') actions.push({ stopProcessingRules: true });
                    }
                }

                const account = await Account.findOne({
                    email,
                    telegramChatId: chatId.toString()
                });

                if (!account) {
                    return this.bot.sendMessage(chatId, `❌ Account ${email} not found.`);
                }

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                // Add this after LINE 135
if (conditions.length === 0) {
    return this.bot.sendMessage(chatId,
        '❌ *Error:* At least one condition required.\n' +
        'Example: `subject:amazon` or `sender:shopify.com`',
        { parse_mode: 'Markdown' }
    );
}
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId, `❌ Failed to connect to account.`);
                }

                const rule = {
                    displayName: ruleName,
                    sequence: 100,
                    isEnabled: true,
                    conditions: conditions.length > 0 ? conditions[0] : {},
                    actions: {}
                };

                actions.forEach(action => {
                    if (action.forwardTo) {
                        rule.actions.forwardTo = [{ emailAddress: { address: action.forwardTo } }];
                    }
                    if (action.delete) rule.actions.delete = true;
                    if (action.markAsRead) rule.actions.markAsRead = true;
                    if (action.stopProcessingRules) rule.actions.stopProcessingRules = true;
                });

                const result = await this.ruleManager.createCustomRule(
                    tokenResult.accessToken,
                    account._id,
                    rule
                );

                account.rules = account.rules || [];
                account.rules.push({
                    ruleId: result.ruleId,
                    name: ruleName,
                    conditions: rule.conditions,
                    actions: rule.actions,
                    isEnabled: true,
                    isSticky: false,
                    createdAt: new Date(),
                    lastVerified: new Date()
                });
                await account.save();

                await this.bot.sendMessage(chatId,
                    `✅ *Rule Created*\n\n` +
                    `📋 Name: \`${ruleName}\`\n` +
                    `📧 Account: ${email}\n` +
                    `🆔 Rule ID: \`${result.ruleId}\`\n\n` +
                    `_Use /rule toggle ${ruleName} ${email} to enable/disable_`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= TOGGLE RULE =============
        this.bot.onText(/\/rule toggle (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [ruleName, email] = match[1].split(' ');

            if (!ruleName || !email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rule toggle "RuleName" user@outlook.com`',
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

                const result = await this.ruleManager.toggleRule(
                    tokenResult.accessToken,
                    ruleName
                );

                const rule = account.rules?.find(r => r.name === ruleName);
                if (rule) {
                    rule.isEnabled = result.isEnabled;
                    await account.save();
                }

                await this.bot.sendMessage(chatId,
                    `${result.isEnabled ? '✅' : '❌'} *Rule ${result.isEnabled ? 'Enabled' : 'Disabled'}*\n\n` +
                    `📋 Rule: \`${ruleName}\`\n` +
                    `📧 Account: ${email}`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= REMOVE RULE =============
        this.bot.onText(/\/rule remove (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [ruleName, email] = match[1].split(' ');

            if (!ruleName || !email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rule remove "RuleName" user@outlook.com`',
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

                if (account.stickyRules?.includes(ruleName)) {
                    return this.bot.sendMessage(chatId,
                        `⚠️ *Cannot remove sticky rule*\n\n` +
                        `\`${ruleName}\` is a sticky rule and will auto-restore.\n` +
                        `Use /rule toggle "${ruleName}" ${email} instead.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                const refreshToken = decryptToken(account.refreshToken);
                const tokenResult = await this.outlookAuth.refreshAccessToken(refreshToken);
                
                if (!tokenResult.success) {
                    return this.bot.sendMessage(chatId, `❌ Failed to connect.`);
                }

                await this.ruleManager.removeRule(tokenResult.accessToken, ruleName);

                account.rules = account.rules?.filter(r => r.name !== ruleName);
                await account.save();

                await this.bot.sendMessage(chatId,
                    `🗑️ *Rule Removed*\n\n` +
                    `📋 Rule: \`${ruleName}\`\n` +
                    `📧 Account: ${email}`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= RESTORE RULE =============
        this.bot.onText(/\/rule restore (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const [ruleName, email] = match[1].split(' ');

            if (!ruleName || !email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rule restore "RuleName" user@outlook.com`',
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

                const rule = account.rules?.find(r => r.name === ruleName);
                if (!rule) {
                    return this.bot.sendMessage(chatId, `❌ Rule not found in backup.`);
                }

                const result = await this.ruleManager.createCustomRule(
                    tokenResult.accessToken,
                    account._id,
                    {
                        displayName: rule.name,
                        conditions: rule.conditions,
                        actions: rule.actions,
                        isEnabled: rule.isEnabled
                    }
                );

                await this.bot.sendMessage(chatId,
                    `🔄 *Rule Restored*\n\n` +
                    `📋 Rule: \`${ruleName}\`\n` +
                    `📧 Account: ${email}\n` +
                    `🆔 New Rule ID: \`${result.ruleId}\``,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });

        // ============= BACKUP RULES =============
        this.bot.onText(/\/rule backup(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const email = match?.[1];

            if (!email) {
                return this.bot.sendMessage(chatId,
                    '❌ *Usage:* `/rule backup user@outlook.com`',
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

                account.rules = rules.map(rule => ({
                    ruleId: rule.id,
                    name: rule.displayName,
                    conditions: rule.conditions,
                    actions: rule.actions,
                    isEnabled: rule.isEnabled,
                    isSticky: account.stickyRules?.includes(rule.displayName) || false,
                    lastVerified: new Date()
                }));
                await account.save();

                await this.bot.sendMessage(chatId,
                    `💾 *Rules Backed Up*\n\n` +
                    `📧 Account: ${email}\n` +
                    `📋 Rules: ${rules.length}\n` +
                    `🕐 Time: ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );

            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            }
        });
    }
}

module.exports = RuleCommands;