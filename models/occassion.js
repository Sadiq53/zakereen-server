require('../config/dataBase')
const mongoose = require('mongoose')
const { allowedTypes } = require('../middlewares/validateUtils')

const occasionSchema = new mongoose.Schema(
    {
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
        createdat: { type: Date, default: Date.now },
        updatedat: { type: Date, default: Date.now },
        time: { type: Date, default: Date.now },
        start_at: { type: Date, default: Date.now },
        ends_at: { type: Date, default: Date.now },
        location: { type: String, default: '' }, // Legacy location description
        locationName: { type: String, default: '' }, // Geocoded name
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        geofenceRadius: { type: Number, default: 150 }, // In meters
        geoRestrictionEnabled: { type: Boolean, default: false },
        name: { type: String, default: '' },
        description: { type: String, default: '' },
        created_by: { type: String, default: '' },
        status: { type: String, default: 'pending' },
        attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        hijri_date: {
            year: { type: Number, default: null },
            month: { type: Number, default: null },
            day: { type: Number, default: null }
        },
        events: [
            {
                type: { type: String },
                name: { type: String },
                party: { type: String },
                rating: [
                    {
                        score: { type: Number, enum: [1, 2, 3, 4, 5] },
                        ratingBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                        createdAt: { type: Date, default: Date.now }
                    }
                ]
            }
        ],
        parties: [
            {
                name: { type: String },
                count: { type: Number }
            }
        ],
        images: [
            {
                url: { type: String, required: true },
                sizeMB: { type: Number },
                uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                createdAt: { type: Date, default: Date.now }
            }
        ],
        // Push notification deduplication flags
        notifiedStarted: { type: Boolean, default: false },
        notifiedReminder: { type: Boolean, default: false },
    },
    { collection: "occasions" }
);

// Multi-tenant indexes
occasionSchema.index({ tenantId: 1, start_at: -1, status: 1 });
occasionSchema.index({ tenantId: 1, status: 1, "events.party": 1 });
occasionSchema.index({ tenantId: 1, status: 1 });
const cacheBuster = require('../utils/cacheBuster');
occasionSchema.plugin(cacheBuster);

module.exports = mongoose.model('occasions', occasionSchema);