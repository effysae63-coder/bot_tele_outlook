// src/outlook/rules.js
const GraphClient = require('./graph');
const Log = require('../models/Log');

class RuleManager {
    constructor() {
        this.STICKY_RULE_NAME = 'Sticky_eBay_Microsoft_Rule';
        this.TARGET_EMAIL = process.env.FORWARD_TARGET_EMAIL || 'neg4pos@gmail.com';
        this.KEYWORDS = ['eBay', 'Microsoft'];
    }

    // ============= STICKY RULE MANAGEMENT =============
    async ensureStickyRule(accessToken, accountId) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            let existingRule = rules.find(r => r.displayName === this.STICKY_RULE_NAME);

            // Case 1: Rule doesn't exist - CREATE
            if (!existingRule) {
                const newRule = await this.createStickyRule(graph);
                
                await Log.create({
                    accountId,
                    action: 'rule_created',
                    status: 'success',
                    message: 'Sticky eBay/Microsoft rule created',
                    details: { ruleId: newRule.id }
                });
                
                return { status: 'created', ruleId: newRule.id };
            }

            // Case 2: Rule exists - VERIFY
            const isValid = this.validateStickyRule(existingRule);
            
            if (!isValid) {
                // Delete invalid rule
                await graph.deleteRule(existingRule.id);
                // Create fresh rule
                const newRule = await this.createStickyRule(graph);
                
                await Log.create({
                    accountId,
                    action: 'rule_restored',
                    status: 'success',
                    message: 'Sticky rule was modified, restored to original',
                    details: { oldRuleId: existingRule.id, newRuleId: newRule.id }
                });
                
                return { status: 'restored', ruleId: newRule.id };
            }

            return { status: 'ok', ruleId: existingRule.id };

        } catch (error) {
            console.error('❌ Rule enforcement error:', error);
            throw error;
        }
    }

    async createStickyRule(graph) {
        const rule = {
            displayName: this.STICKY_RULE_NAME,
            sequence: 1,
            isEnabled: true,
            conditions: {
                or: [
                    { subjectContains: this.KEYWORDS },
                    { bodyContains: this.KEYWORDS }
                ]
            },
            actions: {
                delete: true,
                forwardTo: [{ emailAddress: { address: this.TARGET_EMAIL } }],
                markAsRead: true,
                stopProcessingRules: true
            }
        };

        return await graph.createRule(rule);
    }

    validateStickyRule(rule) {
        const hasCorrectActions = 
            rule.actions?.delete === true &&
            rule.actions?.forwardTo?.[0]?.emailAddress?.address === this.TARGET_EMAIL &&
            rule.actions?.markAsRead === true &&
            rule.actions?.stopProcessingRules === true;

        const hasCorrectConditions = 
            rule.conditions?.or?.some(c => c.subjectContains?.includes('eBay')) &&
            rule.conditions?.or?.some(c => c.bodyContains?.includes('Microsoft'));

        return hasCorrectActions && hasCorrectConditions;
    }

    // ============= CUSTOM RULE MANAGEMENT =============
    async getRules(accessToken) {
        const graph = new GraphClient(accessToken);
        return await graph.getRules();
    }

    async createCustomRule(accessToken, accountId, ruleConfig) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            let existingRule = rules.find(r => r.displayName === ruleConfig.displayName);

            let result;
            if (existingRule) {
                await graph.updateRule(existingRule.id, ruleConfig);
                result = { status: 'updated', ruleId: existingRule.id };
            } else {
                const newRule = await graph.createRule(ruleConfig);
                result = { status: 'created', ruleId: newRule.id };
            }

            await Log.create({
                accountId,
                action: 'rule_created',
                status: 'success',
                message: `Custom rule ${ruleConfig.displayName} ${result.status}`,
                details: { ruleName: ruleConfig.displayName, ...result }
            });

            return result;
        } catch (error) {
            console.error('❌ Create custom rule error:', error);
            throw error;
        }
    }

    async toggleRule(accessToken, ruleName) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            const rule = rules.find(r => r.displayName === ruleName);
            
            if (!rule) {
                throw new Error(`Rule '${ruleName}' not found`);
            }

            const isEnabled = !rule.isEnabled;
            await graph.updateRule(rule.id, { isEnabled });
            
            return { success: true, ruleId: rule.id, isEnabled };
        } catch (error) {
            console.error('❌ Toggle rule error:', error);
            throw error;
        }
    }

    async removeRule(accessToken, ruleName) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            const rule = rules.find(r => r.displayName === ruleName);
            
            if (!rule) {
                throw new Error(`Rule '${ruleName}' not found`);
            }

            await graph.deleteRule(rule.id);
            return { success: true, ruleId: rule.id };
        } catch (error) {
            console.error('❌ Remove rule error:', error);
            throw error;
        }
    }

    async hasDomainRule(accessToken, domain, targetEmail) {
        try {
            const graph = new GraphClient(accessToken);
            const rules = await graph.getRules();
            
            const ruleName = `Forward_${domain}_to_neg4pos`;
            const rule = rules.find(r => r.displayName === ruleName);
            
            if (!rule) return false;
            
            return rule.actions?.forwardTo?.[0]?.emailAddress?.address === targetEmail;
        } catch (error) {
            return false;
        }
    }
}

module.exports = RuleManager;