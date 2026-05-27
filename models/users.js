require('../config/dataBase')
const mongoose = require('mongoose')
const { ALL_ROLES } = require('../middlewares/validateUtils')

const userSchema = new mongoose.Schema({

tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
fullname: { type: String, default: '' },
createdat: { type: Date, default: Date.now },
updatedat: { type: Date, default: Date.now },
userid: { type: String, default: '', index: true },
userpass: { type: String, default: '' },
address: { type: String, default: '' },
phone: { type: String, default: '' },
email: { type: String, default: '' },
role: {
    type: String,
    default: 'member',
    enum: {
        values: ['rootadmin', 'superadmin', 'admin', 'groupadmin', 'member'],
        message: '{VALUE} is not a valid role',
    },
},
title: { type: String, default: '' },
belongsto: { type: String, default: '' },
grade: { type: String, default: '' },
attendence: [{ type: mongoose.Schema.Types.ObjectId, ref: 'occasions' }],
profileImage: {
    s3Url: { type: String, default: '' },
    s3Key: { type: String, default: '' },
},
fcmTokens: { type: [String], default: [] },

});

// Multi-tenant indexes
userSchema.index({ tenantId: 1, userid: 1 }, { unique: true, partialFilterExpression: { tenantId: { $ne: null } } });
userSchema.index({ tenantId: 1, belongsto: 1, role: 1 });
userSchema.index({ tenantId: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);