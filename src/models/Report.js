// src/models/Report.js
const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    reportId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    telegramChatId: {
        type: String,
        index: true
    },
    type: { 
        type: String, 
        enum: ['daily', 'weekly', 'monthly', 'custom'], 
        required: true 
    },
    
    period: {
        start: Date,
        end: Date
    },
    
    summary: {
        totalAccounts: Number,
        activeAccounts: Number,
        rulesEnforced: Number,
        rulesRestored: Number,
        sendersBlocked: Number,
        sendersUnblocked: Number,
        emailsForwarded: Number,
        errors: Number
    },
    
    details: [{
        account: String,
        stats: Object,
        changes: Array
    }]
}, {
    timestamps: true
});

// TTL index - auto delete after 30 days
ReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Report', ReportSchema);