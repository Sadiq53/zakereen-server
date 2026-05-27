const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    occasion: { type: mongoose.Schema.Types.ObjectId, ref: 'occasions', required: true },
    checkedInAt: { type: Date, default: null },
    status: {
        type: String,
        enum: ['absent', 'present', 'late', 'excused'],
        default: 'absent'
    },
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    collection: 'attendance',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Multi-tenant indexes
attendanceSchema.index({ tenantId: 1, occasion: 1, user: 1 }, { unique: true });
attendanceSchema.index({ tenantId: 1, occasion: 1, status: 1 });
attendanceSchema.index({ tenantId: 1, user: 1, status: 1 });
attendanceSchema.index({ tenantId: 1, user: 1, createdAt: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
