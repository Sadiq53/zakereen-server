require('../config/dataBase')
const mongoose = require('mongoose')

const groupSchema = new mongoose.Schema({

    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, default: '' },
    admin: { type: String, default: '' },
    members: { type: [String], default: [] },
    createdat: { type: Date, default: Date.now },
    updatedat: { type: Date, default: Date.now },

});

// Multi-tenant indexes
groupSchema.index({ tenantId: 1, name: 1 }, { unique: true });
const cacheBuster = require('../utils/cacheBuster');
groupSchema.plugin(cacheBuster);

module.exports = mongoose.model('Group', groupSchema);