const mongoose = require('mongoose');

const savedLocationSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    address: { type: String, default: '' },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    collection: 'saved_locations',
    timestamps: true
});

savedLocationSchema.index({ tenantId: 1, name: 1 });

module.exports = mongoose.model('SavedLocation', savedLocationSchema);
