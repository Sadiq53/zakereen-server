require('../config/dataBase')
const mongoose = require('mongoose')

const groupSchema = new mongoose.Schema({

    name: { type: String, default: '', unique: true },
    admin: { type: String, default: '' },
    members: { type: [String], default: [] },
    createdat: { type: Date, default: Date.now },
    updatedat: { type: Date, default: Date.now },

});

module.exports = mongoose.model('Group', groupSchema);  