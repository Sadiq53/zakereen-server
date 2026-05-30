require('../config/dataBase');
const mongoose = require('mongoose');

const announcementGroupSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        type: {
            type: String,
            enum: ['global_jamiat', 'tenant_jamaat', 'custom'],
            required: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tenant',
            default: null, // Null for 'global_jamiat'
        },
        // For custom groups, explicitly store members.
        members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        // Users who can manage this group (add/remove members, change settings)
        admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        // Users who are explicitly granted permission to send messages.
        // NOTE: By default, users with role 'rootadmin' or 'superadmin' can always send messages in any group they belong to.
        allowedSenders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        // If true, standard members cannot send messages unless explicitly in allowedSenders.
        isReadOnly: { type: Boolean, default: true },
        groupIcon: {
            s3Url: { type: String, default: '' },
            s3Key: { type: String, default: '' },
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        pinnedMessage: {
            messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnnouncementMessage', default: null },
            pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            pinnedAt: { type: Date, default: null },
            expiresAt: { type: Date, default: null },
        },
    },
    { timestamps: true }
);

// Indexes for high-performance querying
// 1. Find a specific tenant's jamaat group quickly
announcementGroupSchema.index({ tenantId: 1, type: 1 });
// 2. Find global groups quickly
announcementGroupSchema.index({ type: 1 });
// 3. Find custom groups a user is a member of
announcementGroupSchema.index({ members: 1 });

const cacheBuster = require('../utils/cacheBuster');
announcementGroupSchema.plugin(cacheBuster);

module.exports = mongoose.model('AnnouncementGroup', announcementGroupSchema);
