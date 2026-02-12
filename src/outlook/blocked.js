// src/outlook/blocked.js
const GraphClient = require('./graph');
const Log = require('../models/Log');

class BlockedSendersManager {
    constructor() {
        this.BLOCK_RULE_NAME = 'Blocked Senders - Sticky';
    }

    async getBlockedSenders(accessToken) {
        const graph = new GraphClient(accessToken);
        return await graph.getBlockedSenders();
    }

    async addBlockedSender(accessToken, accountId, domain) {
        const graph = new GraphClient(accessToken);
        
        try {
            await graph.addBlockedSender(domain);
            
            await Log.create({
                accountId,
                action: 'sender_blocked',
                status: 'success',
                message: `Blocked ${domain}`,
                details: { domain }
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
            await graph.removeBlockedSender(domain);
            
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
}

module.exports = BlockedSendersManager;