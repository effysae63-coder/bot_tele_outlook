const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true,
        index: true
    },
    action: {
        type: String,
        enum: [
            'account_connected',
            'account_reconnected',
            'account_removed',
            'rule_created',
            'rule_restored',
            'rule_deleted',
            'rule_toggled',
            'rule_verified',
            'rule_check_failed',        // ✅ ADD THIS
            'blocked_senders_state',     // ✅ ADD THIS
            'domain_blocked',
            'domain_unblocked',
            'domain_forward_rule_created',
            'domain_forward_rule_removed',
            'sender_blocked',
            'sender_unblocked',
            'sender_reblocked',
            'backup_created',
            'backup_restored',
            'snapshot_created',
            'token_refreshed',
            'token_expired',
            'error',
            'warning',
            'info'
        ],
        required: true
    },
    status: {
        type: String,
        enum: ['success', 'failure', 'warning', 'info'],
        default: 'success'
    },
    message: String,
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    error: String,
    ipAddress: String,
    userAgent: String
}, {
    timestamps: true
});

// Compound index for fast report filtering
LogSchema.index({ accountId: 1, createdAt: -1 });

// TTL index - auto delete after 30 days
LogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Log', LogSchema);