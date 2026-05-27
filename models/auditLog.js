const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
    {
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        action: { type: String, required: true },
        resource: { type: String, required: true },
        resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
        details: { type: mongoose.Schema.Types.Mixed, default: null },
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '' },
    },
    { timestamps: true }
);

// Indexes — optimized for tenant-scoped and actor-scoped queries
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Optional: Auto-expire audit logs after 1 year (uncomment if desired)
// auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
