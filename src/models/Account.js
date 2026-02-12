// src/models/Account.js
const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema({
    ruleId: String,
    name: String,
    conditions: Object,
    actions: Object,
    isEnabled: { type: Boolean, default: true },
    isSticky: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastVerified: Date
}, { _id: false });

const SenderRuleSchema = new mongoose.Schema({
    sender: String,
    action: { 
    type: String, 
    enum: ['block', 'forward', 'forward_delete', 'delete', 'markread'] 
},
    targetEmail: String,
    createdAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
}, { _id: false });

const AccountSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true,
        trim: true
    },
    refreshToken: { 
        type: String, 
        required: true 
    },
    accessToken: String,
    tokenExpiry: Date,
    
    // Account status
    status: { 
        type: String, 
        enum: ['active', 'expired', 'reconnect_needed', 'error'], 
        default: 'active' 
    },
    telegramChatId: { 
        type: String, 
        required: true 
    },
    telegramUsername: String,
    
    // Rules
    rules: [RuleSchema],
    stickyRules: [String],
    
    // Sender controls
    blockedSenders: [String],
    forwardRules: [SenderRuleSchema],
    
    // Backup settings
    autoBackup: { type: Boolean, default: true },
    lastBackup: Date,
    
    // Monitoring
    lastChecked: { type: Date, default: Date.now },
    lastActive: Date,
    errorCount: { type: Number, default: 0 },
    
    // Statistics
    stats: {
        rulesEnforced: { type: Number, default: 0 },
        rulesRestored: { type: Number, default: 0 },
        sendersBlocked: { type: Number, default: 0 },
        emailsForwarded: { type: Number, default: 0 },
        alertsSent: { type: Number, default: 0 }
    },
    ruleStats: {
    enforceCount: { type: Number, default: 0 },
    restoreCount: { type: Number, default: 0 },
    lastEnforced: Date,
    lastRestored: Date,
    lastChecked: Date
},
    // History (last 50 actions)
    history: [{
        action: String,
        timestamp: { type: Date, default: Date.now },
        details: Object
    }],
    
    // Metadata
    metadata: {
        type: Map,
        of: String,
        default: {}
    }
}, {
    timestamps: true
});

// Indexes for faster queries
AccountSchema.index({ status: 1 });
AccountSchema.index({ telegramChatId: 1 });
AccountSchema.index({ updatedAt: 1 });

// Update timestamps on save
AccountSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
});

module.exports = mongoose.model('Account', AccountSchema);