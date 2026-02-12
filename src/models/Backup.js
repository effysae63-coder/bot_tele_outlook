// src/models/Backup.js
const mongoose = require('mongoose');

const BackupSchema = new mongoose.Schema({
    backupId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    accountId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Account', 
        required: true,
        index: true
    },
    accountEmail: String,
    
    // Full snapshot
    snapshot: {
        rules: [Object],
        blockedSenders: [String],
        forwardRules: [Object],
        timestamp: { type: Date, default: Date.now }
    },
    
    type: { 
        type: String, 
        enum: ['auto', 'manual', 'snapshot', 'restore'], 
        default: 'manual' 
    },
    
    metadata: {
        createdBy: String,
        reason: String,
        size: Number
    }
}, {
    timestamps: true
});

// TTL index - auto delete after 90 days
BackupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
BackupSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model('Backup', BackupSchema);