const mongoose = require('mongoose');

const kalamSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    type: { type: String, default: 'kalam' },
    createdat: { type: Date, default: Date.now },
    updatedat: { type: Date, default: Date.now }
}, { collection: "kalams" });

kalamSchema.index({ name: 1, type: 1 });
const cacheBuster = require('../utils/cacheBuster');
kalamSchema.plugin(cacheBuster);

module.exports = mongoose.model('kalams', kalamSchema);
