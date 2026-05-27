const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
        status: {
            type: String,
            enum: ['pending_setup', 'active', 'suspended', 'archived', 'deleted'],
            default: 'pending_setup',
        },
        coordinator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        settings: {
            timezone: { type: String, default: 'Asia/Kolkata' },
            locale: { type: String, default: 'en' },
            hijriOffset: { type: Number, default: 0 },
        },
        address: { type: String, default: '' },
        contactEmail: { type: String, default: '' },
        contactPhone: { type: String, default: '' },
        maxUsers: { type: Number, default: 500 },
        suspendedAt: { type: Date, default: null },
        suspendReason: { type: String, default: '' },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Indexes
tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ status: 1 });
tenantSchema.index({ coordinator: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
