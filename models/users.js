require('../config/dataBase')
const mongoose = require('mongoose')
const { ALL_ROLES } = require('../middlewares/validateUtils')

const userSchema = new mongoose.Schema({

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
        values: ['superadmin', 'admin', 'groupadmin', 'member'],
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

// Analytics Indexes
userSchema.index({ belongsto: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);